"""Parse model-supplied controller text without executing it in the implementer."""
import ast
import re

MAX_SOURCE_BYTES = 32_768


def parse_candidate(response):
    """Return source and provenance, or a non-sensitive fallback reason.

    A callback returning a provider-labeled result must identify an actual Meta
    response; a deterministic router fallback is not model-generated code.
    This function only parses syntax. Behavioral certification is mandatory.
    """
    if response is None:
        return None, {'status': 'unavailable'}
    if isinstance(response, dict):
        provider = response.get('provider')
        if provider != 'meta':
            return None, {'status': 'unavailable', 'provider': str(provider or 'unknown')}
        text = response.get('text')
        provenance = 'meta'
    elif isinstance(response, str):
        text = response
        provenance = 'provided'
    else:
        return None, {'status': 'invalid_response'}
    if not isinstance(text, str) or not text.strip():
        return None, {'status': 'invalid_response', 'provider': provenance}
    text = text.strip()
    fences = list(re.finditer(r'```(?:python|py)?\s*\n(.*?)```', text, flags=re.I | re.S))
    if fences:
        if len(fences) != 1:
            return None, {'status': 'invalid_response', 'provider': provenance}
        text = fences[0].group(1).strip()
    if len(text.encode('utf-8')) > MAX_SOURCE_BYTES:
        return None, {'status': 'source_too_large', 'provider': provenance}
    try:
        tree = ast.parse(text, filename='<synthesized-candidate>')
    except (SyntaxError, ValueError, MemoryError, RecursionError):
        return None, {'status': 'invalid_syntax', 'provider': provenance}
    versions = [n.value.value for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'VERSION' for t in n.targets)
                and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)]
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'step']
    if versions != ['v3'] or len(functions) != 1:
        return None, {'status': 'invalid_api', 'provider': provenance}
    args = functions[0].args
    positional = list(args.posonlyargs) + list(args.args)
    if len(positional) != 5 or len(args.defaults) < 1 or args.vararg or args.kwarg or any(not d for d in args.kw_defaults):
        return None, {'status': 'invalid_api', 'provider': provenance}
    return text + '\n', {'status': 'proposed', 'provider': provenance}
