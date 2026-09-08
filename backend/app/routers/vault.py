from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.database import get_session
from app.deps import current_user
from app.models import User, VaultItem
from app.schemas import VaultItemIn, VaultItemOut

# prefix : toutes les routes commencent par /api/vault
# tags   : regroupe ces routes dans la doc Swagger
router = APIRouter(prefix="/api/vault", tags=["vault"])

# Erreur unique et volontairement vague, réutilisée partout.
# On ne distingue PAS "n'existe pas" de "ne t'appartient pas".
NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Élément introuvable",
)


def _owned_item(item_id: int, user: User, session: Session) -> VaultItem:
    """
    Récupère un élément SI et SEULEMENT SI il appartient à l'utilisateur.
    Le filtre user_id est dans la requête SQL elle-même : impossible
    de l'oublier dans une route qui utilise cette fonction.
    """
    item = session.exec(
        select(VaultItem)
        .where(VaultItem.id == item_id)
        .where(VaultItem.user_id == user.id)   # <-- l'isolation est ici
    ).first()

    if item is None:
        raise NOT_FOUND
    return item


@router.get("", response_model=list[VaultItemOut])
def list_items(
    user: User = Depends(current_user),        # 401 automatique si non connecté
    session: Session = Depends(get_session),
):
    """Liste les blobs de l'utilisateur courant. Le serveur ne lit rien."""
    return session.exec(
        select(VaultItem)
        .where(VaultItem.user_id == user.id)
        .order_by(VaultItem.updated_at.desc())
    ).all()


@router.post("", response_model=VaultItemOut, status_code=201)
def create_item(
    data: VaultItemIn,                         # déjà validé par Pydantic
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Stocke un nouveau blob. user_id vient du JWT, jamais du client."""
    item = VaultItem(
        user_id=user.id,                       # <-- surtout pas data.user_id
        label_enc=data.label_enc,
        payload_enc=data.payload_enc,
    )
    session.add(item)
    session.commit()
    session.refresh(item)                      # récupère l'id généré
    return item


@router.put("/{item_id}", response_model=VaultItemOut)
def update_item(
    item_id: int,
    data: VaultItemIn,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Remplace le contenu d'un blob existant."""
    item = _owned_item(item_id, user, session)

    item.label_enc = data.label_enc
    item.payload_enc = data.payload_enc
    item.updated_at = datetime.now(timezone.utc)

    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    user: User = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Supprime un blob. 204 = succès sans contenu de réponse."""
    item = _owned_item(item_id, user, session)
    session.delete(item)
    session.commit()