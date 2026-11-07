"""Model candidates are inert until independently tested and fail closed."""
from pathlib import Path
from backend.db.store import Store
from backend.evolution_engine.engine import EvolutionEngine, TEMPLATES
from backend.evolution_engine.synthesis import parse_candidate


def test_synthesis_parser_requires_provenance_and_controller_api():
    template=(TEMPLATES/'v3.py').read_text()
    source,details=parse_candidate({'provider':'local','text':template})
    assert source is None and details['status']=='unavailable'
    source,details=parse_candidate({'provider':'meta','text':'```python\n'+template+'\n```'})
    assert source and details['status']=='proposed'
    assert parse_candidate({'provider':'meta','text':'VERSION="v3"\ndef step(x): pass'})[0] is None


def test_failed_synthesis_is_committed_reverted_and_falls_back(tmp_path):
    store=Store(force_offline=True,local_path=tmp_path/'store.json')
    # This candidate preserves the AST mutation anchors but is unstable under
    # the actual physics fixtures, so the verifier must reject it.
    broken=(TEMPLATES/'v3.py').read_text().replace('30.0 * math.cos', '300.0 * math.cos')
    summaries=[]
    # Simulate an already-certified live skill; neither rejected candidate may
    # overwrite its database pointer with an unrelated revert commit.
    previous='previous-certified-commit'
    store.local['system_state']=[{'_id':'active_controller','git_commit_hash':previous}]
    verdicts=[]
    original_verdict=store.commit_verdict
    def observe(job_id,record,active_commit,status):
        verdicts.append((status,active_commit))
        return original_verdict(job_id,record,active_commit,status)
    store.commit_verdict=observe
    def synthesize(summary):
        summaries.append(summary)
        return {'provider':'meta','text':broken}
    result=EvolutionEngine(store=store,base_dir=tmp_path/'repos',active_path=tmp_path/'active.py',synthesizer=synthesize).run()
    assert [x['status'] for x in result['iterations']]==['BASELINE','REVERTED','REVERTED','ADOPTED']
    assert result['iterations'][2]['origin']=='synthesized'
    assert result['iterations'][3]['origin']=='local_template'
    assert result['synthesis']['status']=='rejected'
    assert verdicts[0][1]==previous and verdicts[1][1]==previous
    assert verdicts[2][1]==result['active_commit']
    assert len(summaries)==1 and 'worlds' not in summaries[0]
    assert (tmp_path/'active.py').read_text()==(TEMPLATES/'v3.py').read_text()
    history=EvolutionEngine.git(Path(result['repository']),'log','--format=%s')
    assert 'Revert "v3 synthesized candidate"' in history


def test_verified_model_candidate_is_adopted(tmp_path):
    store=Store(force_offline=True,local_path=tmp_path/'store.json')
    model_source=(TEMPLATES/'v3.py').read_text()+'\n# Candidate emitted by the test synthesizer.\n'
    engine=EvolutionEngine(store=store,base_dir=tmp_path/'repos',active_path=tmp_path/'active.py',
                           synthesizer=lambda summary:{'provider':'meta','text':model_source})
    result=engine.run()
    assert [x['status'] for x in result['iterations']]==['BASELINE','REVERTED','ADOPTED']
    assert result['iterations'][-1]['origin']=='synthesized'
    assert result['synthesis']=={'status':'adopted','provider':'meta'}
    assert result['iterations'][-1]['audit']['killed']==6
    assert (tmp_path/'active.py').read_text().rstrip()==model_source.rstrip()
