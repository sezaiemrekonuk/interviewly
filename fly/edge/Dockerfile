# P05 — the edge image. Same `caddy:2-alpine` compose runs; the only difference is that the
# config is baked rather than bind-mounted, because a Fly machine has no host directory to mount
# from. Build context is the repo root, like every other image here.
FROM caddy:2-alpine
COPY fly/edge/Caddyfile /etc/caddy/Caddyfile
# Fails the build rather than the deploy if the config does not parse. Without it a syntax error
# ships and the machine crash-loops with the reason only in `fly logs`.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80
