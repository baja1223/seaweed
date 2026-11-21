Kubernetes Manifests (dev examples)

These are minimal, non-production manifests to run the seaweed stack.
Build the root Dockerfile once and push it as `ghcr.io/your-org/seaweed:latest`.
Each deployment runs a different command in that same image.
Replace the inlined JWT secrets and the Postgres password before any shared cluster.

Apply order
- namespace.yaml
- mongo.yaml, redis.yaml, postgres.yaml
- auth.yaml, chat.yaml, streams.yaml, content.yaml
- frontend.yaml

Notes
- Secrets are inlined for demo (e.g., Postgres password). For production, use Kubernetes Secrets.
- For ingress, add an Ingress controller and rules per your environment.

