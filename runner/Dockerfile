FROM node:22-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY runner/server.mjs ./runner/server.mjs
COPY database/mysql-script.mjs ./database/mysql-script.mjs
ENV NODE_ENV=production
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "runner/server.mjs"]
