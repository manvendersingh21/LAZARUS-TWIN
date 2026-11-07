"""Exercise the REST and WebSocket paths through the actual local uAgents bus."""
from fastapi.testclient import TestClient
from backend.db.store import Store
import backend.main as main


def test_api_and_websocket_with_local_storage(monkeypatch,tmp_path):
    monkeypatch.setenv('LAZARUS_OFFLINE','1')
    monkeypatch.setattr(main,'Store',lambda:Store(force_offline=True,local_path=tmp_path/'db.json'))
    with TestClient(main.app) as client:
        health=client.get('/api/health')
        assert health.status_code==200
        assert health.json()['sponsors']['mongodb']=='local'
        response=client.post('/api/archaeology/inspect',json={'run_active_probes':True})
        assert response.status_code==200
        result=response.json()
        assert result['counts']['UNKNOWN']==0
        assert all(pin['state']=='SEEN' for pin in result['topology']['terminals'])
        assert all(pin.get('offset') and pin.get('governor_function') for pin in result['topology']['terminals'])
        assert result['topology']['physical_wiring_verified'] is True
        assert result['equivalence']['passed']==1000
        assert result['rea']['evidence_id'].startswith('ev_')
        mongo_stats=client.get('/api/mongodb/stats').json()
        assert mongo_stats['mode']=='local'
        assert mongo_stats['graph_nodes_resolved']>0
        assert client.post('/api/sabotage',json={'enabled':True,'thermal_spike':True}).status_code==200
        with client.websocket_connect('/ws') as socket:
            first=socket.receive_json()
            # The heat is latched on the next 100Hz physics scan.
            for _ in range(5):
                if first['right_evolved']['estop']:break
                first=socket.receive_json()
            assert first['sabotage_active']
            assert first['right_evolved']['estop']==1
            assert first['right_evolved']['pwm']==0
        reset=client.post('/api/sabotage',json={'enabled':False,'thermal_spike':False})
        assert reset.status_code==200
        assert reset.json()['snapshot']['right_evolved']['estop']==0
