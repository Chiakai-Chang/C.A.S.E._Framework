---
status: accepted
---

# Separate protocol, skill, CLI, and host integration

C.A.S.E. uses four one-way layers: normative protocol, non-normative portable skill, deterministic reference CLI, and thin host integration. A higher layer may package or guide a lower layer but cannot redefine its semantics; this keeps host behavior and executable adapters from becoming accidental protocol guarantees.
