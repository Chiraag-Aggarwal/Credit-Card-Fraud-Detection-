from datetime import datetime, timedelta, timezone
import hashlib
import os
import re
import secrets

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request


def jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if len(secret.strip()) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters.")
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (ValueError, TypeError):
        return False


def issue_token(user_id: str, role: str, *, session_id: str | None = None, auth_version: int = 0,
                expires_at: datetime | None = None) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "role": role, "type": "access", "aud": "fraud-dashboard",
         "iss": "fraud-api", "iat": now, "exp": expires_at or now + timedelta(days=7),
         "sid": session_id or secrets.token_hex(32), "ver": auth_version},
        jwt_secret(),
        algorithm="HS256",
    )


def session_details() -> tuple[str, datetime]:
    return secrets.token_hex(32), datetime.now(timezone.utc) + timedelta(days=7)


def issue_session(repository, user: dict) -> str | None:
    session_id, expires_at = session_details()
    fresh = repository.create_auth_session(user["_id"], expected_password_hash=user["passwordHash"],
                                           session_id=session_id, expires_at=expires_at)
    if fresh is None:
        return None
    return issue_token(fresh["_id"], fresh["role"], session_id=session_id,
                       auth_version=fresh["authVersion"], expires_at=expires_at)


def new_recovery_codes() -> list[str]:
    values = [secrets.token_hex(16).upper() for _ in range(8)]
    return ["-".join(value[index:index + 4] for index in range(0, len(value), 4)) for value in values]


def recovery_digest(code: str) -> str:
    normalized = re.sub(r"[\s-]", "", code).upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"message": "Authentication is required.", "code": "UNAUTHORIZED"})
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(
            token, jwt_secret(), algorithms=["HS256"], audience="fraud-dashboard",
            issuer="fraud-api", options={"require": ["exp", "iat", "sub", "type", "sid", "ver"]},
        )
        if (payload.get("type") != "access" or not isinstance(payload.get("sid"), str)
                or type(payload.get("ver")) is not int):
            raise jwt.InvalidTokenError("Wrong token purpose")
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        user_id = None
    if not user_id:
        raise HTTPException(status_code=401, detail={"message": "The login session is invalid or expired.", "code": "UNAUTHORIZED"})
    user = request.app.state.db.authenticated_user(user_id, payload["sid"], payload["ver"])
    if not user:
        raise HTTPException(status_code=401, detail={"message": "The login session is invalid or expired.", "code": "UNAUTHORIZED"})
    request.state.auth_session_id = payload["sid"]
    return user


def public_user(user: dict) -> dict:
    return {
        "id": str(user.get("_id", user.get("id"))),
        "name": user["name"],
        "email": user["email"],
        "role": user.get("role", "merchant"),
    }
