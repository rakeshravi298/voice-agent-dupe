# NutriBuddy 

**Empowering Nutrition with Real-Time AI.**

NutriBuddy is a professional platform designed to enhance the connection between dieticians and their clients. It features an intelligent, empathetic AI voice assistant capable of real-time conversation and instant recall of patient medical history through RAG (Retrieval-Augmented Generation).

## ✨ Key Features
- **Real-Time Voice Assistant**: Powered by Gemini Live, providing human-like interaction with low latency.
- **Dietician Dashboard**: Manage patient assignments and track session summaries.
- **RAG System**: Ingest medical records (PDFs) and provide the AI with deep context about patient needs.
- **Cloud Native**: Fully containerized and ready for Google Cloud Run.
- **Unified Login**: A seamless, modern authentication experience for both dieticians and clients.

├── services/               
│   ├── website_service/    # Main App (UI, Auth, Voice Proxy)
│   └── embedding_service/  # PDF processing & vector indexing worker
├── docs/                   # Architecture and deployment guides
├── scripts/                # Cloud setup and data utilities
├── .env.example            # Template for environment variables
└── README.md               # You are here

## 🚀 Quick Start (Local)

1.  **Clone & Install**:
    ```bash
    pip install -r requirements.txt
    ```
2.  **Environment Setup**:
    Copy `.env.example` to `.env` and fill in your Firebase/GCP credentials.
3.  **Run Server**:
    ```bash
    python main.py
    ```
4.  **Access**:
    Visit `http://localhost:5000`

## ☁️ Deployment
This project is designed for **Google Cloud Run**.
Detailed steps can be found in [docs/cloud_deployment_plan.md](docs/cloud_deployment_plan.md).

## 🛡️ Architecture & GCP Integration
NutriBuddy uses a microservices approach with a main proxy server and a specialized embedding worker. 

- **Full System Diagram**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **GCP Integration Proofs**: [docs/GCP_INTEGRATION_PROOFS.md](docs/GCP_INTEGRATION_PROOFS.md) (Live deployment metadata & API evidence)

---

