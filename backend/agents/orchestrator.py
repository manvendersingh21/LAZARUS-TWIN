"""Local uAgents message bus. Work runs behind explicit handlers, never source in messages."""
import asyncio
import json
import secrets
import uuid
from uagents import Agent, Model

class Job(Model):
    request_id: str
    payload: str

class Result(Model):
    request_id: str
    result: str
    error: str = ""

class Orchestrator:
    def __init__(self, handlers):
        self.handlers=handlers
        self.pending={}
        self.context=None
        self.ready=asyncio.Event()
        loop=asyncio.get_running_loop()
        def agent(name):
            return Agent(name=name,seed=secrets.token_hex(32),loop=loop,report_events=False,
                         publish_agent_details=False,enable_agent_inspector=False,mark_inactive_on_shutdown=False,log_level='WARNING')
        self.gateway=agent('WorkbenchGatewayAgent')
        self.roles={'archaeologist':agent('ArchaeologistProberAgent'),
                    'architect':agent('SkillArchitectAgent'),
                    'verifier':agent('AirgappedVerifierAgent')}
        @self.gateway.on_event('startup')
        async def startup(ctx):
            self.context=ctx; self.ready.set()
        @self.gateway.on_message(model=Result)
        async def result(ctx,sender,msg):
            future=self.pending.pop(msg.request_id,None)
            if future and not future.done():
                if msg.error: future.set_exception(RuntimeError(msg.error))
                else: future.set_result(json.loads(msg.result))
        for role, worker in self.roles.items():
            self._register(worker,role)

    def _register(self, worker, role):
        @worker.on_message(model=Job,replies=Result)
        async def handle(ctx,sender,msg):
            try:
                payload=json.loads(msg.payload)
                result=await asyncio.to_thread(self.handlers[role],payload)
                answer=Result(request_id=msg.request_id,result=json.dumps(result,default=str),error='')
            except Exception as exc:
                answer=Result(request_id=msg.request_id,result='null',error=type(exc).__name__+': '+str(exc))
            await ctx.send(sender,answer)

    async def start(self):
        for worker in self.roles.values(): worker.setup()
        self.gateway.setup()
        await asyncio.wait_for(self.ready.wait(),timeout=15)

    async def request(self,role,payload,timeout=180):
        await self.ready.wait()
        request_id=str(uuid.uuid4())
        future=asyncio.get_running_loop().create_future()
        self.pending[request_id]=future
        try:
            await self.context.send(self.roles[role].address,Job(request_id=request_id,payload=json.dumps(payload)))
            return await asyncio.wait_for(future,timeout)
        finally:self.pending.pop(request_id,None)

    async def stop(self):
        self.ready.clear()
        for worker in [self.gateway,*self.roles.values()]:
            await worker._shutdown([])
