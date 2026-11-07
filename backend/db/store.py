"""MongoDB Atlas data engine, with a durable local fallback only when unreachable."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import queue
import threading
import uuid
from urllib.parse import quote

from dotenv import dotenv_values
from pymongo import MongoClient, UpdateOne
from pymongo.errors import CollectionInvalid, ConnectionFailure, ServerSelectionTimeoutError
from backend.rea_archaeologist.build import ROOT


def mongo_uri():
    values = {**dotenv_values(ROOT / ".env"), **os.environ}
    uri = values.get("MONGODB_URI") or values.get("MONGODB_CONNECT")
    if not uri: return None
    uri = uri.strip()
    if not values.get("MONGODB_URI") and values.get("MONGODB_USER") and values.get("MONGODB_PASS"):
        scheme, rest = uri.split("://", 1)
        if "@" in rest: rest = rest.rsplit("@", 1)[1]
        uri = scheme + "://" + quote(values["MONGODB_USER"], safe="") + ":" + quote(values["MONGODB_PASS"], safe="") + "@" + rest
    return uri

class Store:
    def __init__(self, uri=None, force_offline=False, database="lazarus_twin_db", local_path=None):
        self.lock=threading.RLock()
        self.path=Path(local_path) if local_path is not None else ROOT / ".data/db.json"
        self.local=defaultdict(list)
        self.client=None; self.db=None; self.mode="local"; self.reason="MongoDB URI not configured"
        self._subscribers=[]
        self.counters={"graph_nodes_resolved":0,"vector_hits":0,"last_vector_match":None,"change_events":0}
        if self.path.exists():
            self.local.update(json.loads(self.path.read_text()))
        uri = uri or mongo_uri()
        if uri and not force_offline:
            try:
                client=MongoClient(uri,serverSelectionTimeoutMS=3000,connectTimeoutMS=3000)
                client.admin.command("ping")
            except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
                self.reason=type(exc).__name__
            else:
                self.client=client; self.db=client[database]
                self.mode="atlas"; self.reason=None
                self._ensure_schema()
        elif force_offline: self.reason="explicit test mode"

    def _ensure_schema(self):
        names=self.db.list_collection_names()
        if "plc_telemetry_ts" not in names:
            try:
                self.db.create_collection("plc_telemetry_ts",timeseries={"timeField":"timestamp","metaField":"twin_meta","granularity":"seconds"})
            except CollectionInvalid:
                # Another app instance may have created it concurrently.
                pass
        info=self.db.command("listCollections",filter={"name":"plc_telemetry_ts"})["cursor"]["firstBatch"][0]
        options=info.get("options",{}).get("timeseries",{})
        if options.get("timeField")!="timestamp" or options.get("metaField")!="twin_meta" or options.get("granularity")!="seconds":
            raise RuntimeError("plc_telemetry_ts has incompatible time series options")
        self.db.rea_evidence_graph.create_index("node_id",unique=True)
        self.db.rea_evidence_graph.create_index("parent_node_id")
        self.db.agent_skill_memory.create_index("pattern_id",unique=True)
        self.db.airgapped_verification_bus.create_index("job_id",unique=True)

    def _save(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temp=self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.local,default=lambda o:o.isoformat() if isinstance(o,datetime) else str(o)))
        os.replace(temp,self.path)

    def telemetry(self, rows):
        if not rows:return
        for row in rows:
            timestamp=row.get("timestamp")
            if not isinstance(timestamp,datetime) or timestamp.utcoffset() is None:
                raise ValueError("telemetry timestamp must be a timezone-aware UTC datetime")
        if self.db is not None: self.db.plc_telemetry_ts.insert_many([row.copy() for row in rows],ordered=False)
        else:
            with self.lock:
                self.local["plc_telemetry_ts"].extend(rows); self._save()

    def trajectory_stats(self, window_seconds=30):
        """Mean absolute error and overshoot in the most recent telemetry window."""
        cutoff=datetime.now(timezone.utc)-timedelta(seconds=window_seconds)
        if self.db is not None:
            pipeline=[{"$match":{"timestamp":{"$gte":cutoff}}},
                      {"$group":{"_id":"$twin_meta.twin_id","steady_error":{"$avg":{"$abs":"$tracking_error_deg"}},
                                  "peak_overshoot":{"$max":{"$subtract":["$ai_current_angle","$ai_target_angle"]}},
                                  "points":{"$sum":1}}}]
            return list(self.db.plc_telemetry_ts.aggregate(pipeline))
        groups=defaultdict(list)
        for r in self.local["plc_telemetry_ts"]:
            ts=r["timestamp"]
            if isinstance(ts,str):ts=datetime.fromisoformat(ts)
            if ts >= cutoff:groups[r["twin_meta"]["twin_id"]].append(r)
        return [{"_id":k,"steady_error":sum(abs(x["tracking_error_deg"]) for x in v)/len(v),
                 "peak_overshoot":max(x["ai_current_angle"]-x["ai_target_angle"] for x in v),"points":len(v)} for k,v in groups.items()]

    def trajectory_divergence(self, window_seconds=30):
        """RMS and maximum angular separation, paired by run_id and scan tick."""
        cutoff=datetime.now(timezone.utc)-timedelta(seconds=window_seconds)
        if self.db is not None:
            pipeline=[
                {"$match":{"timestamp":{"$gte":cutoff},"tick":{"$exists":True},"run_id":{"$exists":True},
                           "twin_meta.twin_id":{"$in":["LEFT_LEGACY","RIGHT_EVOLVED"]}}},
                {"$group":{"_id":{"run_id":"$run_id","tick":"$tick"},
                           "left":{"$max":{"$cond":[{"$eq":["$twin_meta.twin_id","LEFT_LEGACY"]},"$ai_current_angle",None]}},
                           "right":{"$max":{"$cond":[{"$eq":["$twin_meta.twin_id","RIGHT_EVOLVED"]},"$ai_current_angle",None]}}}},
                {"$match":{"left":{"$ne":None},"right":{"$ne":None}}},
                {"$project":{"delta":{"$abs":{"$subtract":["$left","$right"]}}}},
                {"$group":{"_id":None,"pairs":{"$sum":1},"mean_square":{"$avg":{"$multiply":["$delta","$delta"]}},"max_absolute_delta_deg":{"$max":"$delta"}}},
                {"$project":{"_id":0,"pairs":1,"euclidean_rms_deg":{"$sqrt":"$mean_square"},"max_absolute_delta_deg":1}}]
            result=list(self.db.plc_telemetry_ts.aggregate(pipeline))
            return result[0] if result else {"pairs":0,"euclidean_rms_deg":None,"max_absolute_delta_deg":None}
        pairs=defaultdict(dict)
        for row in self.local["plc_telemetry_ts"]:
            ts=row["timestamp"]
            if isinstance(ts,str):ts=datetime.fromisoformat(ts)
            if ts >= cutoff and row.get("tick") is not None and row.get("run_id") is not None:
                pairs[(row["run_id"],row["tick"])][row["twin_meta"]["twin_id"]]=row["ai_current_angle"]
        diffs=[abs(pair["LEFT_LEGACY"]-pair["RIGHT_EVOLVED"]) for pair in pairs.values() if "LEFT_LEGACY" in pair and "RIGHT_EVOLVED" in pair]
        return {"pairs":len(diffs),"euclidean_rms_deg":math.sqrt(sum(x*x for x in diffs)/len(diffs)) if diffs else None,
                "max_absolute_delta_deg":max(diffs) if diffs else None}

    def save_graph(self,nodes):
        if self.db is not None:
            if nodes:self.db.rea_evidence_graph.bulk_write([UpdateOne({"node_id":n["node_id"]},{"$set":n},upsert=True) for n in nodes])
        else:
            with self.lock:
                all_nodes={n["node_id"]:n for n in self.local["rea_evidence_graph"]}; all_nodes.update({n["node_id"]:n for n in nodes})
                self.local["rea_evidence_graph"]=list(all_nodes.values()); self._save()

    def downstream(self,node_id):
        if self.db is not None:
            pipeline=[{"$match":{"node_id":node_id}},{"$graphLookup":{"from":"rea_evidence_graph","startWith":"$node_id",
                "connectFromField":"node_id","connectToField":"parent_node_id","as":"downstream_3d_wiring"}}]
            data=list(self.db.rea_evidence_graph.aggregate(pipeline))
            result=data[0]["downstream_3d_wiring"] if data else []
            for x in result:x.pop("_id",None)
        else:
            nodes=self.local["rea_evidence_graph"]; frontier=[node_id]; seen=set(); result=[]
            while frontier:
                parent=frontier.pop()
                for n in nodes:
                    if n.get("parent_node_id")==parent and n["node_id"] not in seen:
                        seen.add(n["node_id"]); result.append(n.copy()); frontier.append(n["node_id"])
        self.counters["graph_nodes_resolved"]+=len(result)
        return result

    def promote_evidence(self,node_id,payload):
        """Promote only proven edges; unknown wiring is not established by a probe."""
        descendants=self.downstream(node_id)
        # Each edge in the full path must have an independently verified mapping.
        ids=[node_id]; remaining=descendants[:]
        while remaining:
            eligible=[n for n in remaining if n.get("parent_node_id") in ids and n.get("propagate_seen") is True]
            if not eligible:break
            ids.extend(n["node_id"] for n in eligible)
            remaining=[n for n in remaining if n not in eligible]
        if self.db is not None:
            self.db.rea_evidence_graph.update_many({"node_id":{"$in":ids}},{"$set":{"rea_state":"SEEN","confidence":1.0}})
            self.db.rea_evidence_graph.update_one({"node_id":node_id},{"$set":{"evidence_payload":payload}})
        else:
            with self.lock:
                for n in self.local["rea_evidence_graph"]:
                    if n["node_id"] in ids:n.update(rea_state="SEEN",confidence=1.0)
                    if n["node_id"]==node_id:n["evidence_payload"]=payload
                self._save()
        return len(ids)-1

    def save_pattern(self,pattern):
        self._validate_vector(pattern["embedding"])
        if self.db is not None:self.db.agent_skill_memory.update_one({"pattern_id":pattern["pattern_id"]},{"$set":pattern},upsert=True)
        else:
            with self.lock:
                self.local["agent_skill_memory"]=[p for p in self.local["agent_skill_memory"] if p["pattern_id"]!=pattern["pattern_id"]]+[pattern];self._save()

    def vector_search(self,embedding,pattern_type="PHYSICAL_FAILURE_COMPENSATOR"):
        self._validate_vector(embedding)
        if self.db is not None:
            pipeline=[{"$vectorSearch":{"index":"skill_memory_vector","path":"embedding","queryVector":embedding,"numCandidates":100,"limit":3,
                                         "filter":{"pattern_type":pattern_type}}},
                      {"$project":{"_id":0,"pattern_id":1,"recommended_skill_template":1,"symptom_summary":1,"score":{"$meta":"vectorSearchScore"}}}]
            result=list(self.db.agent_skill_memory.aggregate(pipeline))
        else:
            result=[]
            for p in self.local["agent_skill_memory"]:
                if p["pattern_type"]!=pattern_type:continue
                a,b=embedding,p["embedding"]; denom=math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))
                result.append({**p,"score":sum(x*y for x,y in zip(a,b))/denom if denom else 0})
            result=sorted(result,key=lambda x:x["score"],reverse=True)[:3]
        self.counters["vector_hits"]+=len(result)
        if result:self.counters["last_vector_match"]=result[0]["pattern_id"]
        return result

    @staticmethod
    def _validate_vector(embedding):
        if len(embedding)!=8 or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in embedding):
            raise ValueError("An embedding must contain exactly eight finite numbers")

    def create_vector_index(self):
        if self.db is None:return {"status":"local cosine search"}
        from pymongo.operations import SearchIndexModel
        model=SearchIndexModel(name="skill_memory_vector",type="vectorSearch",definition={"fields":[
            {"type":"vector","path":"embedding","numDimensions":8,"similarity":"cosine"},
            {"type":"filter","path":"pattern_type"}]})
        current=list(self.db.agent_skill_memory.list_search_indexes())
        existing=next((x for x in current if x.get("name")=="skill_memory_vector"),None)
        if existing is None:
            self.db.agent_skill_memory.create_search_index(model)
            return {"status":"requested","name":"skill_memory_vector"}
        return {"status":existing.get("status","unknown"),"queryable":existing.get("queryable",False),"name":"skill_memory_vector"}

    def create_job(self,commit,entrypoint,topology,invariants):
        if not all(isinstance(x,str) and x for x in (commit,entrypoint,topology)):
            raise ValueError("job references must be non-empty strings")
        # The bus carries identifiers and declared invariants, never source or prompts.
        def assert_public(value):
            if isinstance(value,dict):
                for key,item in value.items():
                    if str(key).lower() in {"source","source_code","code","ast","prompt","context","implementation"}:
                        raise ValueError("verification job contains a forbidden field")
                    assert_public(item)
            elif isinstance(value,list):
                for item in value:assert_public(item)
            elif not isinstance(value,(str,int,float,bool,type(None))):
                raise ValueError("invariants must be JSON-compatible")
        assert_public(invariants)
        job={"job_id":str(uuid.uuid4()),"git_commit_hash":commit,"blackbox_entrypoint_id":entrypoint,
             "plc_topology_id":topology,"safety_invariants_spec":invariants,"status":"PENDING","created_at":datetime.now(timezone.utc)}
        if self.db is not None:self.db.airgapped_verification_bus.insert_one(job)
        else:
            with self.lock:
                self.local["airgapped_verification_bus"].append(job.copy());self._save()
                for subscriber in self._subscribers:subscriber.put(job.copy())
        return {k:v for k,v in job.items() if k!="_id"}

    def commit_verdict(self,job_id,record,active_commit,status):
        if status not in ("REJECTED_TRIGGER_GIT_REVERT","CERTIFIED_FOR_HOT_SWAP"):raise ValueError("invalid verdict")
        if self.db is not None:
            with self.client.start_session() as session:
                with session.start_transaction():
                    self.db.evolution_audit_ledger.insert_one(record.copy(),session=session)
                    self.db.system_state.update_one({"_id":"active_controller"},{"$set":{"git_commit_hash":active_commit}},upsert=True,session=session)
                    updated=self.db.airgapped_verification_bus.update_one({"job_id":job_id,"status":"PENDING"},{"$set":{"status":status}},session=session)
                    if updated.modified_count!=1:raise RuntimeError("Verification job missing or already resolved")
        else:
            with self.lock:
                job=next((j for j in self.local["airgapped_verification_bus"] if j["job_id"]==job_id and j["status"]=="PENDING"),None)
                if not job:raise RuntimeError("Verification job missing or already resolved")
                self.local["evolution_audit_ledger"].append(record.copy());self.local["system_state"]=[{"_id":"active_controller","git_commit_hash":active_commit}];job["status"]=status;self._save()

    def watch_jobs(self,callback,stop):
        if self.db is None:
            events=queue.Queue()
            with self.lock:self._subscribers.append(events)
            try:
                while not stop.is_set():
                    try:doc=events.get(timeout=0.5)
                    except queue.Empty:continue
                    with self.lock:self.counters["change_events"]+=1
                    callback(doc)
            finally:
                with self.lock:self._subscribers.remove(events)
            return
        with self.db.airgapped_verification_bus.watch([{"$match":{"operationType":"insert"}}],full_document="updateLookup",max_await_time_ms=1000) as stream:
            while not stop.is_set():
                change=stream.try_next()
                if change:
                    with self.lock:self.counters["change_events"]+=1
                    doc=change["fullDocument"];doc.pop("_id",None);callback(doc)

    def stats(self):
        count=self.db.plc_telemetry_ts.count_documents({}) if self.db is not None else len(self.local["plc_telemetry_ts"])
        return {"mode":self.mode,"offline_reason":self.reason,"time_series_points":count,**self.counters}

    def close(self):
        if self.client is not None:self.client.close()
