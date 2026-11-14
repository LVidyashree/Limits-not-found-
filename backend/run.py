import uvicorn
from app.config import settings

if __name__ == "__main__":
    print(f"🚀 Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    print(f"📖 Interactive Swagger Docs: http://127.0.0.1:8000/docs")
    print(f"📖 ReDoc Documentation: http://127.0.0.1:8000/redoc")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
