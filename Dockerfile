# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Copy root package files
COPY package*.json ./
# Copy workspace packages
COPY server/package*.json ./server/

# Install dependencies
RUN npm install
RUN cd server && npm install

# Copy source code
COPY . .

# Build the application
# Frontend
RUN npm run build
# Backend
RUN cd server && npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install native dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy built files
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package*.json ./server/
COPY --from=build /app/package*.json ./

# Install only production dependencies for server
RUN cd server && npm install --omit=dev

# Set environment
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000

# Volume for data persistence
VOLUME /app/data

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server/dist/index.js"]