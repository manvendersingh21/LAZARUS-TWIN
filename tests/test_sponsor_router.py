"""The model clients preserve provider attribution and deterministic offline behavior."""
import httpx
from backend.llm_router.router import Router


def test_offline_result_never_claims_remote_inference():
    router=Router(offline=True)
    result=router.assess_evidence({'counts':{'UNKNOWN':1}})
    assert result['meta_analysis']['provider']=='local'
    assert result['subq_unknown_branch_decision']['provider']=='local'
    assert result['subq_unknown_branch_decision']['probability'] is None
    assert result['subq_unknown_branch_decision']['decision'] is True


def test_real_provider_endpoints_and_parsing_with_stubbed_transport(monkeypatch):
    router=Router(offline=True)
    router.offline=False
    router.values={'META_API_KEY':'test-key','SUBQUADRATIC_API_KEY':'test-key'}
    observed=[]
    def post(url,headers,json,timeout):
        observed.append((url,json))
        request=httpx.Request('POST',url)
        if 'meta.ai' in url:
            return httpx.Response(200,request=request,json={'choices':[{'message':{'content':'Observed evidence only.'}}]})
        return httpx.Response(200,request=request,json={'answers':{'decision':{'noul':0.9}}})
    monkeypatch.setattr('backend.llm_router.router.httpx.post',post)
    result=router.assess_evidence({'counts':{'UNKNOWN':1}})
    assert result['meta_analysis']['provider']=='meta'
    assert result['subq_unknown_branch_decision']['provider']=='subquadratic'
    assert result['subq_unknown_branch_decision']['decision'] is True
    assert any(url=='https://api.meta.ai/v1/chat/completions' for url,body in observed)
    assert any(url=='https://api.subq.ai/v1/systemone' and body['model']=='subq-snap-1.1' for url,body in observed)
