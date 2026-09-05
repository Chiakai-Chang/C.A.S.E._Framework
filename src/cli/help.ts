export const HUMAN_HELP = `case-agent 0.1.0-preview

Local dossier integrity reference CLI. Human mode is the default; add --json for one machine-readable result envelope.

Commands
  case-agent init --operation <id>
  case-agent dossier create --operation <id> --actor <label> --title <text> --objective <text> --brief <json>
  case-agent dossier show --dossier <id>
  case-agent dossier check --dossier <id>
  case-agent evidence add --dossier <id> --operation <id> --run <id> --evidence <json>
  case-agent submission create --dossier <id> --operation <id> --run <id>
  case-agent decision accept --dossier <id> --operation <id> --submission <id> --submission-digest <digest> --reviewer <label> --criteria <json-array> --comment <text>
  case-agent decision reject --dossier <id> --operation <id> --submission <id> --submission-digest <digest> --reviewer <label> --criteria <json-array> --comment <text>
  case-agent handoff offer --dossier <id> --operation <id> --from-run <id> --to-actor <label>
  case-agent handoff accept --dossier <id> --operation <id> --handoff <id> --offered-content-digest <digest> --actor <label>
  case-agent guard recover --dossier <id> --operation <id>

Existing-dossier mutations require --expected-revision and --expected-state-digest in --json mode. Human mode may omit them only when this invocation displays and confirms the exact basis. Decisions and guard recovery require an interactive terminal; there is no --yes path.

Offline and data boundary
  No network, telemetry, or update checks are performed by core commands. State is stored only under the repository-local .case-agent/ namespace. Evidence records references and digests; artifact bytes are not copied. Removing this CLI does not remove dossier data. Dossier content may contain sensitive repository information and the tool does not detect all secrets.

Support and safety boundary
  Windows production mutation is unsupported in this preview and fails closed with CASE_E_UNSUPPORTED_PROFILE. No production POSIX profile is claimed. Passing checks proves only declared machine-checkable invariants. Recorded Human Acceptance is not authenticated identity. Guard recovery stops unless process termination can be established. There is no physical-power-loss, network-filesystem, multi-machine, non-cooperating-writer, supply-chain, or privacy guarantee. No sandbox or complete audit guarantee is provided.
`;
