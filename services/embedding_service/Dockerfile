# Use the official Python image
FROM python:3.11-slim

# Allow statements and errors to be immediately logged to the Cloud Run logs
ENV PYTHONUNBUFFERED True

# Set the working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy the service code and requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the actual service code
COPY . ./

# Run the worker on container startup
# Port 8080 is default
CMD exec functions-framework --target=process_pdf --port=$PORT
