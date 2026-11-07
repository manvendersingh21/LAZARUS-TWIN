"""AST mutation is performed by the auditor, never by the verifier."""
import ast
import hashlib
import hmac
import json
import os
import tempfile
from pathlib import Path
from backend.rea_archaeologist.build import ROOT
from .verifier import verify_isolated

def _unwrap_clamp(node):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("max", "min") and len(node.args) == 2:
        for arg in node.args:
            if isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name) and arg.func.id in ("max", "min") and len(arg.args) == 2:
                for inner in arg.args:
                    if not (isinstance(inner, ast.Constant) or (isinstance(inner, ast.UnaryOp) and isinstance(inner.operand, ast.Constant))):
                        return inner
                return arg.args[-1]
        for arg in node.args:
            if not (isinstance(arg, ast.Constant) or (isinstance(arg, ast.UnaryOp) and isinstance(arg.operand, ast.Constant))):
                return arg
    return None

class Mutator(ast.NodeTransformer):
    def __init__(self, mutation): self.mutation, self.changed = mutation, False
    def visit_If(self, node):
        if self.mutation == "invalid_inputs" and not self.changed and isinstance(node.test, ast.UnaryOp) and isinstance(node.test.op, ast.Not):
            self.changed = True
            return None
        return self.generic_visit(node)
    def visit_Constant(self, node):
        replacements = {"thermal":(88.0,1000.0),"cooling":(72.0,1000.0),"runaway":(45.0,450.0)}
        if self.mutation in replacements and not self.changed:
            old,new = replacements[self.mutation]
            if isinstance(node.value, (int, float)) and not isinstance(node.value, bool) and float(node.value) == old:
                self.changed=True
                return ast.copy_location(ast.Constant(new), node)
        return node
    def visit_Assign(self, node):
        if self.mutation == "direction" and not self.changed and any(isinstance(t,ast.Name) and t.id=="error" for t in node.targets):
            self.changed=True
            node.value=ast.BinOp(left=ast.Name(id="angle",ctx=ast.Load()),op=ast.Sub(),right=ast.Name(id="target",ctx=ast.Load()))
        elif self.mutation == "saturation" and not self.changed and any(isinstance(t,ast.Name) and t.id=="pwm" for t in node.targets):
            unwrapped = _unwrap_clamp(node.value)
            if unwrapped is not None:
                node.value = unwrapped
                self.changed = True
        return self.generic_visit(node)
    def visit_Dict(self, node):
        self.generic_visit(node)
        if self.mutation == "saturation" and not self.changed:
            for i, key in enumerate(node.keys):
                value=node.values[i]
                if isinstance(key,ast.Constant) and key.value=="pwm":
                    unwrapped = _unwrap_clamp(value)
                    if unwrapped is not None:
                        node.values[i] = unwrapped
                        self.changed = True
        return node

def audit(path=None):
    path = Path(path or ROOT / ".skills/controllers/active_skill.py")
    original = path.read_text()
    baseline_result = verify_isolated(path)
    results=[]
    with tempfile.TemporaryDirectory(prefix="lazarus-mutants-") as tmp:
        for name in ("thermal", "cooling", "runaway", "saturation", "invalid_inputs", "direction"):
            mutator=Mutator(name)
            tree=mutator.visit(ast.parse(original))
            ast.fix_missing_locations(tree)
            if not mutator.changed: raise ValueError(f"AST mutation {name} did not apply")
            mutant=Path(tmp)/f"{name}.py"
            mutant.write_text(ast.unparse(tree)+"\n")
            verdict=verify_isolated(mutant)
            results.append({"mutation":name,"killed":not verdict["passed"],"failures":verdict["failures"]})
    payload={"candidate_sha256":hashlib.sha256(path.read_bytes()).hexdigest(), "baseline":baseline_result,
             "mutants":results, "killed":sum(x["killed"] for x in results), "total":len(results),
             "isolation": baseline_result["isolation"]}
    key_dir=ROOT / ".data"
    key_dir.mkdir(exist_ok=True)
    key_path=key_dir/"receipt.key"
    if not key_path.exists():
        fd=os.open(key_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"wb") as f: f.write(os.urandom(32))
    payload["signature_hmac_sha256"]=hmac.new(key_path.read_bytes(),json.dumps(payload,sort_keys=True,separators=(",",":")).encode(),hashlib.sha256).hexdigest()
    return payload

if __name__ == "__main__":
    print(json.dumps(audit(),indent=2))
