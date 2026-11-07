import httpx

from backend.llm_router.router import Router


def test_offline_fallback_does_not_claim_model_probability():
    router = Router(offline=True)
    assert router.meta("prompt", "recovered controller")["provider"] == "local"
    assert router.subq_decision("state", "question", True) == {
        "provider": "local", "probability": None, "decision": True
    }
    assert router.connections() == {"meta": "offline", "subquadratic": "offline"}


def test_real_api_shapes_are_handled_without_network(monkeypatch):
    seen = []
    def post(url, *, headers, json, timeout):
        seen.append((url, json))
        request = httpx.Request("POST", url)
        body = ({"choices": [{"message": {"content": "control hypothesis"}}]}
                if "meta.ai" in url else {"answers": {"decision": {"noul": 0.75}}})
        return httpx.Response(200, request=request, json=body)
    monkeypatch.setattr(httpx, "post", post)
    router = Router()
    router.offline = False
    router.values = {"META_API_KEY": "test", "SUBQUADRATIC_API_KEY": "test"}
    assert router.meta("question", "fallback") == {"provider": "meta", "text": "control hypothesis"}
    assert router.subq_decision("state", "question")["probability"] == 0.75
    assert seen[0][1]["model"] == "muse-spark-1.3"
    assert seen[1][1]["model"] == "subq-snap-1.1"
    assert seen[1][0].endswith("/v1/systemone")
    assert router.connections() == {"meta": "connected", "subquadratic": "connected"}


def test_invalid_subq_probability_falls_back_without_exposing_response(monkeypatch):
    def post(url, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", url),
                              json={"answers": {"decision": {"noul": 1.5}}})
    monkeypatch.setattr(httpx, "post", post)
    router = Router()
    router.offline = False
    router.values = {"SUBQUADRATIC_API_KEY": "test"}
    result = router.subq_decision("state", "question", True)
    assert result == {"provider": "local", "probability": None, "decision": True}
    assert router.connections()["subquadratic"] == "unavailable: ValueError"


def test_offline_evidence_analysis_is_advisory_and_deterministic():
    router = Router(offline=True)
    first = router.assess_evidence({"counts": {"UNKNOWN": 1}})
    assert first == router.assess_evidence({"counts": {"UNKNOWN": 1}})
    assert first["advisory_only"] is True
    assert first["meta_analysis"]["provider"] == "local"
    assert first["subq_unknown_branch_decision"]["decision"] is True


def test_meta_accepts_text_blocks_and_rejects_invalid_prompt(monkeypatch):
    import pytest
    def post(url, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", url),
                              json={"choices": [{"message": {"content": [{"type": "text", "text": "analysis"}]}}]})
    monkeypatch.setattr(httpx, "post", post)
    router = Router()
    router.offline = False
    router.values = {"META_API_KEY": "test"}
    assert router.meta("test", "fallback")["text"] == "analysis"
    with pytest.raises(TypeError):
        router.meta(None, "fallback")


def test_truncated_meta_response_is_not_presented_as_complete(monkeypatch):
    def post(url, **kwargs):
        assert kwargs["json"]["reasoning_effort"] == "minimal"
        assert kwargs["json"]["max_completion_tokens"] == 4096
        return httpx.Response(200, request=httpx.Request("POST", url),
                              json={"choices": [{"finish_reason": "length", "message": {"content": "incomplete"}}]})
    monkeypatch.setattr(httpx, "post", post)
    router = Router()
    router.offline = False
    router.values = {"META_API_KEY": "test"}
    assert router.meta("test", "fallback") == {"provider": "local", "text": "fallback"}
    assert router.connections()["meta"] == "unavailable: TruncatedResponse"
