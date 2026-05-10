FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY lib/ ./lib/
COPY . ./artifacts/api-server/
RUN pnpm install --ignore-scripts
RUN pnpm --filter @workspace/api-server build
EXPOSE 3001
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
