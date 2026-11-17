FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Empty: the browser calls its own origin and nginx forwards /api to the backend (see nginx.conf.template).
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# The nginx image renders /etc/nginx/templates/*.template with the environment at start-up.
# API_UPSTREAM: where /api is forwarded (host:port). DNS_RESOLVER: Docker 127.0.0.11; Railway [fd12::10].
# API_ORIGIN / API_WS_ORIGIN: only for an API on another origin; leave empty for the same-origin setup.
ENV API_UPSTREAM=api:8000 DNS_RESOLVER=127.0.0.11 API_ORIGIN= API_WS_ORIGIN=
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
