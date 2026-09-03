# Biomotif is a pure client-side app: the build folds the engine, the stylesheet
# and the .mtf motif library into static files, and nginx serves them. There is
# no server component, no state and no runtime configuration.

FROM python:3.13-alpine AS build
WORKDIR /app

# The build script has no dependencies; it reads the library and the example
# sequences straight out of the repo, so nothing needs installing.
COPY tools/build_web.py tools/
COPY web/src/ web/src/
COPY biomotif/lib/ biomotif/lib/
COPY data/ data/

RUN python tools/build_web.py --dist web/dist

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
