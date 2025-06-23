#Build stage
FROM node:16-alpine AS build

WORKDIR /app

ENV GENERATE_SOURCEMAP=false

ENV NODE_OPTIONS=--max-old-space-size=8192

RUN apk update
RUN apk add --no-cache make gcc g++ zlib-dev

COPY package*.json .

COPY LKH-2.0.10 .
COPY LKH-2.0.10/Makefile ./LKH-2.0.10/Makefile
COPY LKH-2.0.10/SRC/ ./LKH-2.0.10/SRC/
WORKDIR /app/LKH-2.0.10
RUN make clean
RUN make
RUN chmod +x /app/LKH-2.0.10/LKH

WORKDIR /app
RUN npm install
COPY . .
RUN mkdir -p lkh-input && chmod -R 777 lkh-input
RUN mkdir -p lkh-output && chmod -R 777 lkh-output

RUN npm run build

