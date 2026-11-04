#!/usr/bin/env python3
"""
Play a scripted race at the backend as F1 23 UDP packets, to watch the race
lights without starting the game. Takes about a minute.

    python3 scripts/lights_demo.py [host] [port]
"""
import socket
import struct
import sys
import time

HEADER = '<H5BQf2I2B'
PLAYER = 0

host = sys.argv[1] if len(sys.argv) > 1 else '127.0.0.1'
port = int(sys.argv[2]) if len(sys.argv) > 2 else 20777
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
start = time.time()
state = {"sc": 0, "flag": 0, "lap": 1, "last_ms": 0, "invalid": 0, "pit": 0}


def header(packet_id):
    return struct.pack(HEADER, 2023, 23, 1, 0, 1, packet_id, 42, time.time() - start, 0, 0, PLAYER, 255)


def send(data):
    sock.sendto(data, (host, port))


def event(code, body=b''):
    print(f'  event {code}')
    send((header(3) + code.encode() + body).ljust(45, b'\0'))


def send_state():
    session = bytearray(700)
    session[3] = 50                         # total laps
    session[49] = state["sc"]
    send(header(1) + bytes(session))

    laps = bytearray(22 * 50 + 2)
    o = PLAYER * 50
    struct.pack_into('<I', laps, o, state["last_ms"])
    laps[o + 31] = state["lap"]
    laps[o + 32] = state["pit"]
    laps[o + 35] = state["invalid"]
    send(header(2) + bytes(laps))

    status = bytearray(22 * 55)
    struct.pack_into('<b', status, PLAYER * 55 + 28, state["flag"])
    send(header(7) + bytes(status))


def hold(seconds):
    end = time.time() + seconds
    while time.time() < end:
        send_state()
        time.sleep(0.5)


def step(label, seconds=0.0, **changes):
    print(label)
    state.update(changes)
    hold(seconds)


step('session starts, lamps get snapshotted', 2)
for n in range(1, 6):
    print(f'start light {n}')
    event('STLG', bytes([n]))
    hold(1)
step('lights out', 0)
event('LGOT')
hold(3)
step('yellow flag', 4, flag=3)
step('green again', 2, flag=0)
step('safety car', 6, sc=1)
step('virtual safety car', 5, sc=2)
step('track clear', 2, sc=0)
step('lap 1 done, 1:30.000', 2, lap=2, last_ms=90000)
step('lap 2 done, 1:29.000 (personal best)', 3, lap=3, last_ms=89000)
step('lap 3 done, 1:28.500, fastest lap overall', 0, lap=4, last_ms=88500)
event('FTLP', struct.pack('<Bf', PLAYER, 88.5))
hold(3)
step('track limits, lap invalidated', 2, invalid=1)
print('penalty')
event('PENA', struct.pack('<3B', 4, 7, PLAYER))
hold(2)
step('pit lane', 5, lap=5, invalid=0, pit=1)
step('back on track', 2, pit=0)
print('chequered flag')
event('CHQF')
hold(4)
print('session ends, lamps restored')
event('SEND')
