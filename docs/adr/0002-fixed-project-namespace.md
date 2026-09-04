---
status: accepted
---

# Use one fixed, non-invasive project namespace

C.A.S.E. v0.x owns only `.case-agent/` during initialization and fails closed when an existing directory has no compatible ownership manifest. The namespace is not configurable in v0.x, and host instruction files are connected only through a separate explicit operation, because flexible paths and automatic root-file edits spread discovery and collision complexity across every host.
