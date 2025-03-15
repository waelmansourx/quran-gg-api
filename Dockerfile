FROM node:20-bullseye-slim

# Set working directory
WORKDIR /app

# Install system dependencies including FFmpeg and Canvas dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Create directories for RunPod
RUN mkdir -p temp /inputs /outputs && chmod 777 temp /inputs /outputs

# Expose port
EXPOSE 3000 8000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV RUNPOD_WEBHOOK_GET_LOGS=true
ENV RUNPOD_WEBHOOK_DOWNLOAD_OUTPUT=false
ENV RUNPOD_HANDLER_PORT=8000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Command to run the application (use RunPod handler in production)
CMD ["npm", "run", "start:runpod"]