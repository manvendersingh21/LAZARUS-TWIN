"""Check local fallback semantics without requiring or touching Atlas."""
from datetime import datetime, timezone
import threading
import time
import pytest
from backend.db.store import Store


def local_store(tmp_path):
    return Store(force_offline=True,local_path=tmp_path/'state.json')


def test_telemetry_and_verified_evidence_propagation(tmp_path):
    store=local_store(tmp_path)
    common={'timestamp':datetime.now(timezone.utc),'run_id':'r','tick':1,
            'ai_target_angle':30.,'tracking_error_deg':0.}
    store.telemetry([
        {**common,'twin_meta':{'twin_id':'LEFT_LEGACY'},'ai_current_angle':10.},
        {**common,'twin_meta':{'twin_id':'RIGHT_EVOLVED'},'ai_current_angle':18.},
    ])
    assert store.stats()['time_series_points']==2
    assert store.trajectory_divergence()['euclidean_rms_deg']==8.0
    store.save_graph([
        {'node_id':'branch','parent_node_id':None,'rea_state':'UNKNOWN','confidence':0},
        {'node_id':'proven','parent_node_id':'branch','rea_state':'UNKNOWN','confidence':0,'propagate_seen':True},
        {'node_id':'proposed','parent_node_id':'branch','rea_state':'UNKNOWN','confidence':0,'propagate_seen':False},
    ])
    assert len(store.downstream('branch'))==2
    assert store.promote_evidence('branch',{'samples':[1,2]})==1
    nodes={node['node_id']:node for node in store.local['rea_evidence_graph']}
    assert nodes['proven']['rea_state']=='SEEN'
    assert nodes['proposed']['rea_state']=='UNKNOWN'


def test_local_job_events_and_verdict_are_consistent(tmp_path):
    store=local_store(tmp_path)
    stop=threading.Event(); messages=[]
    thread=threading.Thread(target=store.watch_jobs,args=(messages.append,stop),daemon=True)
    thread.start()
    try:
        deadline=time.monotonic()+3
        while not store._subscribers and time.monotonic()<deadline:
            time.sleep(.01)
        assert store._subscribers
        job=store.create_job('commit','entrypoint','topology',{'thermal_cutoff_c':88.})
        deadline=time.monotonic()+3
        while not messages and time.monotonic()<deadline:
            time.sleep(.01)
        assert messages[0]['job_id']==job['job_id']
        store.commit_verdict(job['job_id'],{'version':'v1'},'commit','CERTIFIED_FOR_HOT_SWAP')
        with pytest.raises(RuntimeError):
            store.commit_verdict(job['job_id'],{'version':'duplicate'},'commit','CERTIFIED_FOR_HOT_SWAP')
        assert len(store.local['evolution_audit_ledger'])==1
        assert store.local['airgapped_verification_bus'][0]['status']=='CERTIFIED_FOR_HOT_SWAP'
    finally:
        stop.set();thread.join(timeout=3)
        assert not thread.is_alive()
