Kubernetes Manifests (dev examples)

These are minimal, non-production manifests to run the seaweed stack.
You must build and push images for each service or adjust deployments to use your images.

Apply order
- namespace.yaml
- mongo.yaml, redis.yaml, postgres.yaml
- auth.yaml, chat.yaml, streams.yaml, content.yaml
- frontend.yaml

Notes
- Secrets are inlined for demo (e.g., Postgres password). For production, use Kubernetes Secrets.
- For ingress, add an Ingress controller and rules per your environment.

