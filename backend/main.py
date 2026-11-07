"""API and synchronized live twin stream."""
import asyncio
import json
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
import logging
import os
import subprocess
import threading
import time
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agents.orchestrator import Orchestrator
from backend.db.store import Store
from backend.evolution_engine.engine import EvolutionEngine
from backend.llm_router.router import Router
from backend.physics_sim.engine import DualTwin
from backend.prober.probe import probe, equivalence
from backend.rea_archaeologist.inspect import inspect
from backend.rea_archaeologist.build import ROOT, build
from backend.verifier_agent.mutation import audit

logger=logging.getLogger('lazarus')

class InspectionRequest(BaseModel):
    run_active_probes: bool=False
class SabotageRequest(BaseModel):
    enabled: bool=True
    thermal_spike: bool=False
    auto_evolve: bool=False

class Workbench:
    def __init__(self):
        self.store=Store()
        self.sim=DualTwin()
        self.router=Router()
        self.engine=EvolutionEngine(self.sim,self.store,synthesizer=self.synthesize)
        self.run_id=str(uuid.uuid4())
        self.binary_sha=build()['sha256']
        self.latest_inspection=None
        self.latest_evolution=None
        self.vector_index_status=None
        try:
            self.vector_index_status=self.store.create_vector_index()
            self.store.save_pattern({'pattern_id':'gravity-lag-pid','pattern_type':'PHYSICAL_FAILURE_COMPENSATOR',
                'symptom_summary':'Torque loss with gravity sag and oscillation under sensor lag',
                'embedding':[.58,.42,25.,4.5,.45,1.2,30.,1.],
                'recommended_skill_template':'Clamped integral, cosine gravity feedforward, filtered velocity',
                'verification_status':'candidate; evaluate before use'})
        except Exception as exc:
            self.vector_index_status={'status':'unavailable','reason':type(exc).__name__}
        self.events=[]
        self.stop=threading.Event()
        self.watch_thread=None
        self.telemetry_error=None
        self.telemetry_queue=asyncio.Queue(maxsize=50)
        self.telemetry_dropped_points=0
        self.orchestrator=None

    def inspect(self,payload):
        data=inspect()
        nodes=[{'node_id':e['node_id'],'parent_node_id':None,'rea_state':e['state'],'confidence':e['confidence'],
                'evidence_payload':e.get('payload')} for e in data['evidence']]
        pin_parents={'%QX0.0':'THERMAL_BOUNDARY','%QX0.1':'COOLING_BOUNDARY'}
        for pin in data['topology']['terminals']:
            nodes.append({'node_id':'PIN_'+pin['id'],'parent_node_id':pin_parents.get(pin['id']),
                          'rea_state':pin['state'],'confidence':0.0,'propagate_seen':False,
                          'evidence_payload':{'label':pin['label'],'note':pin['note']}})
        self.store.save_graph(nodes)
        if payload.get('run_active_probes'):
            findings=probe()
            by_id={e['node_id']:e for e in findings['findings']}
            data['evidence']=[by_id.get(e['node_id'],e) for e in data['evidence']]
            for item in findings['findings']:
                if item['state']=='SEEN':self.store.promote_evidence(item['node_id'],item['payload'])
            data['probes']=findings
            data['equivalence']=equivalence()
            evm=subprocess.run([str(ROOT/'node_modules/node/bin/node'),str(ROOT/'scripts/evm_probe.cjs')],cwd=ROOT,check=True,capture_output=True,text=True,timeout=40)
            data['evm_probe']=json.loads(evm.stdout.strip().splitlines()[-1])
            data['counts']={state:sum(e['state']==state for e in data['evidence']) for state in ('SEEN','INFERRED','UNKNOWN')}
            summary={key:data[key] for key in ('counts','evidence','probes','equivalence','evm','evm_probe')}
            summary['raw_disassembly']=json.loads((ROOT/'build/rea_evidence.json').read_text())['raw_result']['stdout']
            summary['evm_opcode_trace']=json.loads((ROOT/'build/evm_trace.json').read_text())
            summary['evm_bytecode']=(ROOT/'contracts/legacy_governor.hex').read_text().strip()
            if self.latest_evolution:
                history=subprocess.run(['git','-C',self.latest_evolution['repository'],'log','--format=%H %s'],capture_output=True,text=True,check=True,timeout=10)
                summary['skill_git_history']=history.stdout
            data['sponsor_analysis']=self.router.assess_evidence(summary)
        self.latest_inspection=data
        return data

    def synthesize(self, failure):
        """Ask Muse for a candidate; the verifier, never the model, decides promotion."""
        if self.router.offline:
            return None
        baseline=(ROOT/'backend/evolution_engine/templates/v1.py').read_text()
        prompt=("Write only a Python controller module, with no markdown. Use import math, VERSION = 'v3', "
                "and step(target, angle, velocity, temp, state=None) returning pwm, estop and cooling. "
                "Preserve the baseline nonfinite fail-safe, error = target - angle, thresholds 72.0, 88.0, "
                "45.0, and the max(-100.0, min(100.0, ...)) output clamp. Improve tracking under torque "
                "loss and gravity using bounded integral anti-windup, cosine feedforward and filtered "
                "velocity. No I/O, extra imports or network. Use dt=0.01 seconds. The candidate will be "
                "sandboxed, mutation-tested and rejected unless it passes independent worlds. "
                "Failure summary: "+json.dumps(failure,default=str)+"\nRecovered baseline:\n"+baseline)
        return self.router.meta(prompt,"")

    def evolve(self,payload):
        result=self.engine.run()
        self.latest_evolution=result
        return result

    def verify(self,payload):
        # Only the named local handle is resolved here; source never enters the verifier process.
        if payload.get('entrypoint','active') != 'active':raise ValueError('unknown entrypoint')
        return audit()

    def event(self,doc):
        self.events.append({'type':'verification_job','job_id':doc.get('job_id'),'git_commit_hash':doc.get('git_commit_hash'),'status':doc.get('status')})
        del self.events[:-20]

    def start_watcher(self):
        def run():
            try:self.store.watch_jobs(self.event,self.stop)
            except Exception as exc:logger.error('Verification event stream failed: %s',type(exc).__name__)
        self.watch_thread=threading.Thread(target=run,name='verification-bus',daemon=True)
        self.watch_thread.start()

    def frame(self):
        frame=self.sim.snapshot()
        frame['sabotage_active']=frame['left_legacy']['sabotage_active']
        if self.events:frame['event']=self.events[-1]
        return frame

    def rows(self,frame):
        timestamp=datetime.now(timezone.utc)
        rows=[]
        for name,twin_id in [('left_legacy','LEFT_LEGACY'),('right_evolved','RIGHT_EVOLVED')]:
            arm=frame[name]
            rows.append({'timestamp':timestamp,'run_id':self.run_id,'tick':frame['tick'],
              'twin_meta':{'twin_id':twin_id,'binary_sha256':self.binary_sha,
                           'skill_version':'legacy' if name=='left_legacy' else frame['active_skill_version'],
                           'sabotage_active':arm['sabotage_active']},
              'ai_target_angle':arm['target_angle'],'ai_current_angle':arm['angle'],
              'ai_angular_vel':arm['velocity'],'ai_core_temp_c':arm['temperature'],
              'qw_motor_torque_pwm':arm['pwm'],'qx_estop_relay':arm['estop'],'qx_cooling_relay':arm['cooling'],
              'tracking_error_deg':arm['tracking_error_deg']})
        return rows

    async def physics(self):
        loop=asyncio.get_running_loop(); deadline=loop.time(); batch=[]; last_flush=loop.time()
        while True:
            deadline += .01
            frame=self.sim.step()
            batch.extend(self.rows(frame))
            if loop.time()-last_flush >= 5.0:
                pending,batch=batch,[]
                try:self.telemetry_queue.put_nowait(pending)
                except asyncio.QueueFull:
                    self.telemetry_error='telemetry_queue_full'
                    self.telemetry_dropped_points+=len(pending)
                    logger.error('Telemetry queue full; scan batch dropped')
                last_flush=loop.time()
            if loop.time()-deadline > .25:deadline=loop.time()
            await asyncio.sleep(max(0,deadline-loop.time()))

    async def write_telemetry(self):
        while True:
            pending=await self.telemetry_queue.get()
            try:
                await asyncio.to_thread(self.store.telemetry,pending)
                self.telemetry_error=None
            except Exception as exc:
                self.telemetry_error=type(exc).__name__
                logger.error('Telemetry batch failed: %s',self.telemetry_error)
            finally:self.telemetry_queue.task_done()

@asynccontextmanager
async def lifespan(app):
    workbench=await asyncio.to_thread(Workbench)
    app.state.workbench=workbench
    workbench.orchestrator=Orchestrator({'archaeologist':workbench.inspect,'architect':workbench.evolve,'verifier':workbench.verify})
    await workbench.orchestrator.start()
    workbench.start_watcher()
    task=asyncio.create_task(workbench.physics())
    writer=asyncio.create_task(workbench.write_telemetry())
    try:yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):await task
        with suppress(asyncio.TimeoutError):await asyncio.wait_for(workbench.telemetry_queue.join(),5)
        writer.cancel()
        with suppress(asyncio.CancelledError):await writer
        workbench.stop.set()
        if workbench.watch_thread:await asyncio.to_thread(workbench.watch_thread.join,3)
        await workbench.orchestrator.stop()
        workbench.sim.close()
        workbench.store.close()

app=FastAPI(title='LAZARUS-TWIN',lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST'],allow_headers=['*'])

def wb():return app.state.workbench

@app.get('/api/health')
def health():
    state=wb()
    repo=state.latest_evolution['repository'] if state.latest_evolution else str(ROOT)
    result=subprocess.run(['git','-C',repo,'rev-parse','HEAD'],text=True,capture_output=True)
    return {'status':'ok','active_skill_version':state.sim.snapshot()['active_skill_version'],
            'git_commit':result.stdout.strip() if result.returncode==0 else None,
            'sponsors':{**state.router.connections(),'mongodb':state.store.mode,'fetch_ai':'local uAgents'},
            'telemetry_error':state.telemetry_error,'telemetry_dropped_points':state.telemetry_dropped_points,'vector_index':state.vector_index_status}

@app.post('/api/archaeology/inspect')
async def archaeology(request:InspectionRequest):
    return await wb().orchestrator.request('archaeologist',request.model_dump())

@app.post('/api/sabotage')
async def sabotage(request:SabotageRequest):
    state=wb()
    if not request.enabled and not request.thermal_spike:
        state.sim.reset(); state.run_id=str(uuid.uuid4())
    else: state.sim.set_fault(request.enabled,request.thermal_spike)
    if request.auto_evolve:
        return await state.orchestrator.request('architect',{})
    return {'snapshot':state.frame(),'iterations':state.latest_evolution['iterations'] if state.latest_evolution else []}

@app.post('/api/evolve')
async def evolve():return await wb().orchestrator.request('architect',{})

@app.post('/api/verify')
async def verify():return await wb().orchestrator.request('verifier',{'entrypoint':'active'})

@app.get('/api/mongodb/stats')
def mongodb_stats():return wb().store.stats()

@app.websocket('/ws')
async def websocket(socket:WebSocket):
    await socket.accept()
    try:
        while True:
            await socket.send_json(wb().frame())
            await asyncio.sleep(1/60)
    except (WebSocketDisconnect,RuntimeError):pass
