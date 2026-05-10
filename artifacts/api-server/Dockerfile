FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --ignore-scripts
RUN pnpm --filter @workspace/api-server build
EXPOSE 3001
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
