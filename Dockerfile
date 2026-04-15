# Build stage
FROM node:18 AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

# Serve with Caddy
FROM caddy:alpine
COPY --from=build /app/dist /usr/share/caddy
EXPOSE 80