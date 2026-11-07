"""Exercise actual external tools and the black-box gate, without contacting Atlas."""
from backend.prober.probe import equivalence, probe
from backend.rea_archaeologist.inspect import inspect
from backend.verifier_agent.mutation import audit


def test_rea_evidence_and_boundary_probes():
    result=inspect()
    assert result['rea']['provider']['id']=='gnu.objdump'
    assert result['rea']['evidence_id'].startswith('ev_')
    assert result['evm']['evidence_id'].startswith('ev_')
    assert result['rea']['instruction_count'] > 0
    assert all(result['counts'][s] > 0 for s in ('SEEN','INFERRED','UNKNOWN'))
    assert len(result['topology']['terminals'])==7
    findings=probe()
    assert len(findings['findings'])==3
    assert all(item['state']=='SEEN' for item in findings['findings'])
    assert findings['gains']['proportional_sample']==3.0
    assert findings['gains']['velocity_sample']==-0.8


def test_recovered_baseline_matches_one_thousand_vectors():
    result=equivalence(1000)
    assert result['passed']==1000
    assert result['mismatches']==[]


def test_verifier_detects_all_six_mutants():
    result=audit()
    assert result['baseline']['passed']
    assert result['killed']==result['total']==6
    assert result['isolation']['filesystem']=='denied'
    assert result['isolation']['network']=='seccomp-denied'
    assert len(result['signature_hmac_sha256'])==64
