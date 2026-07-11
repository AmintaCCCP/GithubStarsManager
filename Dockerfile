# Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Remove default nginx config that conflicts with ours
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy built files from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx configuration template (rendered at startup with BACKEND_HOST)
COPY nginx.conf.template /etc/nginx/nginx.conf.template

# Expose port
EXPOSE 80

# Render the nginx config (substituting BACKEND_HOST, defaulting to backend:3000)
# and start nginx
CMD ["sh", "-c", "export BACKEND_HOST=${BACKEND_HOST:-backend:3000}; envsubst '${BACKEND_HOST}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]