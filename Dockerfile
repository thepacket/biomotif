# Biomotif is a pure client-side app: the build folds the engine, the stylesheet
# and the .mtf motif library into static files, and nginx serves them. There is
# no server component, no state and no runtime configuration.

FROM node:22-alpine AS build
WORKDIR /app

# The build has no dependencies, so there is nothing to install: it reads the
# motif library and the example sequences straight out of the repo.
COPY package.json ./
COPY tools/build.mjs tools/
COPY web/src/ web/src/
COPY library/ library/
COPY data/ data/

RUN node tools/build.mjs --dist web/dist

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
