from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services import progress


router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    await progress.register(websocket)
    try:
        while True:
            # Discard client pings — connection stays open until client closes.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await progress.unregister(websocket)
