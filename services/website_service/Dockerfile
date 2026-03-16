# Use the official Python image
FROM python:3.11-slim

# Allow statements and errors to be immediately logged to the Cloud Run logs
ENV PYTHONUNBUFFERED True

# Set the working directory
WORKDIR /app

# Install system dependencies (if needed)
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the code
COPY . ./

# Run the web service on container startup
# Port 8080 is the default for Cloud Run, but our app uses $PORT
CMD exec python main.py
