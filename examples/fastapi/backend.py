"""Disposable synthetic business backend. OpenAPI is exported by FastAPI,
not copied from MoonAPI or hand-authored by the integration runner.
No MoonAPI imports, real accounts, files, databases or external connections.
"""
import json
import socket
import sys
from typing import Annotated, Literal

import fastapi
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

fault = sys.argv[1] if len(sys.argv) == 2 else "healthy"
assert fault in {"healthy", "response-type", "double-refund", "tenant-leak", "never-done"}
app = FastAPI(title="MoonAPI controlled independent framework", version="1")
auth = HTTPBearer(scheme_name="tenant")
orders = {}
jobs = {}
balances = {"tenant-a": 1000, "tenant-b": 1000}
stocks = {"tenant-a": 10, "tenant-b": 10}


def tenant(c: Annotated[HTTPAuthorizationCredentials, Depends(auth)]) -> str:
    if c.credentials not in balances:
        raise HTTPException(401, "synthetic credentials required")
    return c.credentials


Tenant = Annotated[str, Depends(tenant)]
errors = {401: {"description": "unauthorized"}, 404: {"description": "not owned"}, 409: {"description": "invalid transition"}}


class Quantity(BaseModel):
    quantity: int = Field(ge=1, le=4)
    tag: str = Field(min_length=1, max_length=96)


class Order(BaseModel):
    id: str
    tag: str
    quantity: int
    state: Literal["reserved", "paid", "refunded"]


class Balance(BaseModel):
    balance: int
    available: int


class Quote(BaseModel):
    total: int = Field(ge=0)


class Job(BaseModel):
    id: str
    state: Literal["pending", "done"]


def owned(id: str, t: str):
    value = orders.get(id)
    if not value or (value["owner"] != t and fault != "tenant-leak"):
        raise HTTPException(404, "not owned")
    return value


@app.get("/quote", operation_id="quote", response_model=Quote)
def quote(quantity: Annotated[int, Query(ge=1, le=10)]):
    if fault == "response-type":
        return JSONResponse({"total": "invalid-synthetic-number"})
    return {"total": quantity * 10}


@app.get("/balance", operation_id="balance", response_model=Balance, responses=errors)
def balance(t: Tenant):
    return {"balance": balances[t], "available": stocks[t]}


@app.post("/orders", operation_id="reserve", response_model=Order, status_code=201, responses=errors)
def reserve(q: Quantity, t: Tenant):
    if stocks[t] < q.quantity:
        raise HTTPException(409, "insufficient stock")
    stocks[t] -= q.quantity
    id = str(len(orders) + 1)
    order = {"id": id, "owner": t, "tag": q.tag, "quantity": q.quantity, "state": "reserved"}
    orders[id] = order
    return order


@app.get("/orders/{id}", operation_id="read", response_model=Order, responses=errors)
def read(id: str, t: Tenant):
    return owned(id, t)


@app.post("/orders/{id}/pay", operation_id="pay", response_model=Order, responses=errors)
def pay(id: str, t: Tenant):
    order = owned(id, t)
    if order["state"] != "reserved":
        raise HTTPException(409, "already paid")
    balances[t] -= order["quantity"] * 10
    order["state"] = "paid"
    return order


@app.post("/orders/{id}/refund", operation_id="refund", response_model=Order, responses=errors)
def refund(id: str, t: Tenant):
    order = owned(id, t)
    if order["state"] == "paid" or (order["state"] == "refunded" and fault == "double-refund"):
        balances[t] += order["quantity"] * 10
        stocks[t] += order["quantity"]
        order["state"] = "refunded"
    elif order["state"] != "refunded":
        raise HTTPException(409, "not paid")
    return order


@app.delete("/orders/{id}", operation_id="remove", status_code=204, responses=errors)
def remove(id: str, t: Tenant):
    order = owned(id, t)
    # Explicit owned cleanup also compensates a partially executed candidate.
    if order["state"] == "reserved":
        stocks[t] += order["quantity"]
    elif order["state"] == "paid":
        stocks[t] += order["quantity"]
        balances[t] += order["quantity"] * 10
    del orders[id]
    return Response(status_code=204)


@app.post("/jobs", operation_id="submit", response_model=Job, status_code=202)
def submit():
    id = str(len(jobs) + 1)
    jobs[id] = 0
    return {"id": id, "state": "pending"}


@app.get("/jobs/{id}", operation_id="poll", response_model=Job, responses={404: {"description": "missing"}})
def poll(id: str):
    if id not in jobs:
        raise HTTPException(404, "missing")
    jobs[id] += 1
    return {"id": id, "state": "done" if jobs[id] >= 3 and fault != "never-done" else "pending"}


if __name__ == "__main__":
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    print(json.dumps({"port": sock.getsockname()[1], "fastapi": fastapi.__version__}), flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False, limit_concurrency=16))
    server.run(sockets=[sock])
