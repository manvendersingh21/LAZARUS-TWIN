# LAZARUS-TWIN

LAZARUS-TWIN is a **demo engineering workbench** for inspecting a stripped industrial-controller artifact, comparing a recovered controller with it, and exercising a safety-gated control-skill evolution loop. It renders a PLC cabinet and two robot arms in a WebSocket-driven 3D scene. The supplied target binaries and contracts are demonstration artifacts compiled from the source in this repository, not recovered vendor software.

## Run the demo

On Linux, install Python 3 with `venv`, Node/npm, Git, GCC, `strip`, `nm`, and GNU `objdump`, then run:

```bash
./scripts/start_demo.sh
```

The setup script creates `.venv` and installs missing Python and Node dependencies. It installs `rea-agents` as an **external npm package** and uses a local Node 22 executable for REA. The first setup needs package-registry access. Open <http://localhost:5173>; the API listens on port 8010. Press Ctrl-C to stop both services. Ports must be free, and the Vite proxy expects port 8010.

Select **Probe Unknown Branches** to run the REA/objdump inspection, controller boundary sweeps, and 1,000-vector comparison. Use the sabotage controls to load the arm, trigger the evolution sequence, or test the thermal stop. Reset clears the simulated emergency latch.

## Configure integrations

Place optional credentials in an untracked `.env` in the repository root. Never commit or share the file:

```dotenv
# Choose either a complete URI, or the connection string and credentials below.
MONGODB_URI=
MONGODB_CONNECT=
MONGODB_USER=
MONGODB_PASS=

META_API_KEY=
META_MODEL=muse-spark-1.3
SUBQUADRATIC_API_KEY=
# Optional: disable live Meta and SubQ calls (does not disable MongoDB).
LAZARUS_OFFLINE=1
```

With a reachable MongoDB deployment the application uses the `lazarus_twin_db` database, including a time-series collection, graph traversal, vector search, change streams and transactional audit updates. When no MongoDB URI is configured or the server is unreachable at startup, it uses a local JSON store under `.data/`. A reachable deployment with insufficient permissions or unsupported features reports an error rather than pretending that an Atlas operation succeeded. Atlas Vector Search requires its `skill_memory_vector` search index to finish provisioning before recall works; index status is not a successful recall. Configuring credentials does not itself prove provider connectivity.

Active probing sends demo evidence to Meta and Subquadratic when their keys are configured. The SubQ request includes the disassembly, EVM trace and probe matrix; the Meta advisory prompt uses a smaller summary. Set `LAZARUS_OFFLINE=1` to use the explicitly labeled deterministic model fallbacks; this setting does not disable MongoDB. SubQ Snap is called on the Decisions API. Local Fetch.ai uAgents carry workbench jobs among the archaeologist, architect, verifier, and gateway. No agent registration with an external Fetch.ai service is required for local operation.

The MongoDB change-stream subscriber dispatches registered verification jobs to the isolated execution layer. The websocket displays events; audit verdict, job status, and active controller pointer are updated together in a MongoDB transaction. Git and MongoDB cannot share a transaction, so evolution uses a compensating workflow across the two systems.

## Verify

```bash
./scripts/verify_all.sh
```

This compiles and checks the stripped executable, invokes external REA with GNU objdump, executes boundary probes and 1,000 seeded stripped-executable-versus-shared-library-versus-Python vectors, runs six AST mutants through the restricted verifier, exercises the Git commit/revert/adopt sequence and five simulation fixtures, tests REST and WebSocket paths with an isolated local data store, runs EVM comparisons on a real local Anvil instance, and builds the frontend. It fails if required tools or dependencies are unavailable. These checks do not require Atlas connectivity or mutate the configured Atlas database.

To inspect service state while the demo runs:

- `GET /api/health` — active skill, Git commit, provider configuration and telemetry errors.
- `POST /api/archaeology/inspect` — pass `{"run_active_probes": true}` to run the sweeps and differential test.
- `POST /api/sabotage` — accepts `enabled`, `thermal_spike`, and `auto_evolve` booleans.
- `POST /api/evolve` and `POST /api/verify` — run the evolution loop and mutation audit.
- `GET /api/mongodb/stats` — storage mode and database counters.
- `WS /ws` — twin telemetry and verification-job events.

## Boundaries and interpretation

- This is a **simulation and research demo**, not a PLC safety system or an authorization to operate machinery. Physical parameters and the PLC layout are demo assumptions. Wiring and assembly-to-pin relationships without evidence remain unknown; sampled behavior does not prove actual wiring.
- The 1,000-vector check is **sampled differential testing**, not a formal proof of equivalence. EVM testing installs the supplied demonstration runtime bytecode on a local Anvil node and compares it with the reconstructed contract, using integer-scaled inputs. It does not establish equivalence for all EVM inputs.
- The recovered baseline and overfit candidate are authored demo templates; the application does not synthesize a baseline from an arbitrary unknown binary. Muse can propose the adaptive candidate, which must pass all gates; a verified local template is used when Muse is unavailable or its candidate fails. The vector query uses a preset failure signature, not a learned embedding.
- The five deterministic benchmark worlds are held out from the live workcell but their fixtures are readable in this repository; they are not secret or physically sealed. Evolution records real commits and a real revert inside an isolated Git skill repository under `.data/skill_repositories/`, then copies the approved skill to `.skills/controllers/`.
- The verifier process is denied filesystem access with Linux Landlock and blocks network and process-inspection syscalls with seccomp. Candidate workers are also restricted before module execution, and the mutation auditor runs separately, but this is not an information-theoretic airgap or a substitute for independent adversarial infrastructure. The receipt uses a local HMAC key, not a third-party signature. Linux Landlock ABI 3+ and `libseccomp` are required; the verifier fails closed when isolation cannot be established.
- The simulation latches the emergency stop until reset; the stateless recovered controller and Solidity function do not independently prove latch behavior.
- The backend performs fixed-step rotational and thermal simulation. The frontend uses Rapier kinematic rigid bodies driven by the backend's telemetry. The 100 Hz simulation and 60 Hz broadcast are best-effort scheduling targets; frame rate depends on host and browser performance.
- `.env`, generated targets, local audit data, skill repositories, virtual environments, and dependencies are ignored by Git. The target source remains visible under `targets/`; the `.vault` copy is a demo artifact, not a protected secret vault.
