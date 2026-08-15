"""Plant-model chat routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import assert_model_allowed, require_action
from backend_api.http.schemas.plant_model import (
    PlantModelChatRequest,
    PlantModelChatResponse,
    PlantModelConversationDetail,
    PlantModelConversationSummary,
)
from backend_api.http.services.analytics_service import record_module_use
from backend_api.http.services.plant_model_chat_service import (
    ConversationAccessDenied,
    assert_conversation_access,
    conversation_to_detail,
    conversation_to_summary,
    delete_conversation,
    get_conversation,
    list_conversations_for_user,
    persist_turn,
)
from backend_api.http.services.plant_model_service import run_plant_model_chat

router = APIRouter(prefix="/plant-model", tags=["plant-model"])


@router.get("/conversations", response_model=list[PlantModelConversationSummary])
def list_plant_model_conversations(
    user: User = Depends(require_action("module:upload")),
    db: Session = Depends(get_db),
) -> list[PlantModelConversationSummary]:
    conversations = list_conversations_for_user(db, user.id)
    return [
        PlantModelConversationSummary(**conversation_to_summary(c)) for c in conversations
    ]


@router.get("/conversations/{conversation_id}", response_model=PlantModelConversationDetail)
def get_plant_model_conversation(
    conversation_id: int,
    user: User = Depends(require_action("module:upload")),
    db: Session = Depends(get_db),
) -> PlantModelConversationDetail:
    conversation = get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    try:
        assert_conversation_access(conversation, user)
    except ConversationAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return PlantModelConversationDetail(**conversation_to_detail(conversation))


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plant_model_conversation(
    conversation_id: int,
    user: User = Depends(require_action("module:upload")),
    db: Session = Depends(get_db),
) -> None:
    conversation = get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    try:
        assert_conversation_access(conversation, user)
    except ConversationAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    delete_conversation(db, conversation)


@router.post("/chat", response_model=PlantModelChatResponse)
def plant_model_chat(
    request: PlantModelChatRequest,
    user: User = Depends(require_action("module:upload")),
    db: Session = Depends(get_db),
) -> PlantModelChatResponse:
    assert_model_allowed(user, request.model)

    if request.conversation_id is not None:
        existing = get_conversation(db, request.conversation_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        try:
            assert_conversation_access(existing, user)
        except ConversationAccessDenied as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    record_module_use(user.id, "plant_model")
    response = run_plant_model_chat(request)
    conversation = persist_turn(
        db,
        user_id=user.id,
        conversation_id=request.conversation_id,
        user_message=request.user_message.strip(),
        assistant_reply=response.reply,
        llm_model=request.model,
        session_state=response.session_state,
        final_result=response.final_result,
    )
    response.conversation_id = conversation.id
    return response
