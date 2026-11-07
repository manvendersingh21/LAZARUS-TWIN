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
    assert {pin['state'] for pin in result['topology']['terminals']}=={'INFERRED','UNKNOWN'}
    assert all(pin.get('offset') and pin.get('governor_function') for pin in result['topology']['terminals'])
    findings=probe()
    assert len(findings['findings'])==3
    assert all(item['state']=='SEEN' for item in findings['findings'])
    assert findings['gains']['proportional_sample']==3.0
    assert findings['gains']['velocity_sample']==-0.8
    assert result['plc_targets']['openplc_runtime']['evidence_id'].startswith('ev_')
    assert result['plc_targets']['openplc_runtime']['instruction_count'] > 4000
    assert 'image_tables_bind_located_vars' in result['plc_targets']['openplc_runtime']['functions_discovered']
    assert 'image_tables_zero_outputs' in result['plc_targets']['openplc_runtime']['functions_discovered']
    assert result['plc_targets']['fulmatic_cortex_m4']['evidence_id'].startswith('ev_')
    assert '.text.MotionControl' in result['plc_targets']['fulmatic_cortex_m4']['text_sections']
    assert '.text.SetVelocity' in result['plc_targets']['fulmatic_cortex_m4']['text_sections']
    assert result['plc_targets']['fulmatic_cortex_m4']['thumb2_instruction_count'] == 1102
    assert findings['probes']['openplc_ffi_probe']['passed'] is True
    assert findings['probes']['openplc_ffi_probe']['located_globals_matched'] == 7
    assert findings['probes']['openplc_ffi_probe']['zero_outputs_verified'] is True
    assert findings['probes']['openplc_ffi_probe']['physics_engine']['held_out_worlds_total'] == 5
    assert findings['probes']['fulmatic_arm_probe']['passed'] is True
    assert findings['probes']['fulmatic_arm_probe']['physics_engine']['held_out_worlds_total'] == 5
    assert findings['probes']['fulmatic_arm_probe']['physics_engine']['nominal_peak_overshoot_deg'] < findings['probes']['openplc_ffi_probe']['physics_engine']['nominal_peak_overshoot_deg']


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
