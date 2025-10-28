FROM  node:lts-slim

ARG HTTP_PROXY
ARG HTTPS_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}

COPY . /home/app
RUN cd /home/app \
    && npm i \
    && npm run build

EXPOSE 9100
WORKDIR /home/app
CMD [ "bash", "-c", "npm run start" ]
