package main

import (
	"encoding/json"
	"testing"
	"time"
)

func testReady(playerID string) *Ready {
	return &Ready{PlayerID: playerID}
}

func TestServerOwnsPosition(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("join: %v", err)
	}
	if !simulation.ApplyInput("player-a", gameplayInput{Tick: 1, X: 1, Z: 0}) {
		t.Fatalf("first input was rejected")
	}
	for index := 0; index < 3; index++ {
		simulation.Step()
	}
	player := simulation.players["player-a"]
	if player == nil {
		t.Fatalf("player missing")
	}
	if player.X <= 0 || player.Z != 0 {
		t.Fatalf("position = (%v, %v), want server-integrated x movement only", player.X, player.Z)
	}
	if player.X == 999 {
		t.Fatalf("client position was accepted")
	}
	packets := simulation.Step()
	if len(packets) != 0 {
		// The fourth simulation tick is not a 20 Hz snapshot boundary.
		t.Fatalf("tick %d emitted a snapshot", simulation.Tick())
	}
}

func TestStaleInput(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("join: %v", err)
	}
	if !simulation.ApplyInput("player-a", gameplayInput{Tick: 4, X: 1, Z: 0}) {
		t.Fatalf("fresh input was rejected")
	}
	if simulation.ApplyInput("player-a", gameplayInput{Tick: 3, X: -1, Z: 0}) {
		t.Fatalf("stale input was applied")
	}
	player := simulation.players["player-a"]
	if player == nil || player.InputX != 1 || player.LastInputTick != 4 {
		t.Fatalf("stale input changed state: %+v", player)
	}
}

func TestDroppedInputDoesNotMovePlayer(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("join: %v", err)
	}
	for index := 0; index < 60; index++ {
		simulation.Step()
	}
	player := simulation.players["player-a"]
	if player == nil {
		t.Fatalf("player missing")
	}
	if player.X != 0 || player.Z != 0 {
		t.Fatalf("dropped input moved player to (%v, %v)", player.X, player.Z)
	}
}

func TestActionDeduplication(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("join: %v", err)
	}
	for _, item := range []struct {
		id       uint64
		accepted bool
	}{
		{id: 10, accepted: true},
		{id: 10, accepted: false},
		{id: 9, accepted: false},
		{id: 11, accepted: true},
	} {
		if got := simulation.ApplyAction("player-a", gameplayAction{ID: item.id}); got != item.accepted {
			t.Fatalf("action %d accepted=%v, want %v", item.id, got, item.accepted)
		}
	}
}

func TestRejoinStartsFresh(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("first join: %v", err)
	}
	simulation.ApplyInput("player-a", gameplayInput{Tick: 10, X: 1, Z: 0})
	simulation.ApplyAction("player-a", gameplayAction{ID: 7})
	simulation.Leave("player-a")
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("rejoin: %v", err)
	}
	player := simulation.players["player-a"]
	if player == nil {
		t.Fatalf("rejoined player missing")
	}
	if player.HasInput || player.HasAction || player.X != 0 || player.Z != 0 {
		t.Fatalf("rejoin reused stale state: %+v", player)
	}
}

func TestInvalidGameplayPayload(t *testing.T) {
	simulation := NewGameSimulation(time.Unix(0, 0))
	if err := simulation.Join(testReady("player-a")); err != nil {
		t.Fatalf("join: %v", err)
	}
	invalidInputs := []string{
		`{"tick":1,"x":0,"z":0,"position":99}`,
		`{"tick":1,"x":"1","z":0}`,
		`{"tick":1,"x":1,"z":NaN}`,
		`{"tick":1,"x":0}`,
		`{"tick":1,"x":0,"x":1,"z":0}`,
	}
	for _, payload := range invalidInputs {
		if _, err := parseGameplayInput([]byte(payload)); err == nil {
			t.Fatalf("accepted invalid input %s", payload)
		}
	}
	if player := simulation.players["player-a"]; player == nil || player.HasInput {
		t.Fatalf("invalid input changed player state: %+v", player)
	}
	if _, err := parseGameplayAction([]byte(`{"id":-1}`)); err == nil {
		t.Fatalf("accepted negative action id")
	}
	if _, err := parseGameplayClockProbe([]byte(`{"probeId":1,"clientSentMs":"1"}`)); err == nil {
		t.Fatalf("accepted string clock value")
	}

	var snapshot gameplaySnapshot
	if err := json.Unmarshal([]byte(`{"tick":3,"serverMonoMs":4.5,"player":{"id":"player-a","x":1,"z":2,"lastActionId":0}}`), &snapshot); err != nil {
		t.Fatalf("snapshot schema is not JSON: %v", err)
	}
	if snapshot.Player.ID != "player-a" {
		t.Fatalf("snapshot player = %q", snapshot.Player.ID)
	}
}

func TestClockProbeReplyCarriesAReceiveAndSendSample(t *testing.T) {
	probe := gameplayClockProbe{ProbeID: 7, ClientSentMs: 11.5}
	payload, err := encodeClockReply(probe, 20.25, 20.5)
	if err != nil {
		t.Fatalf("encode clock reply: %v", err)
	}
	var reply gameplayClockReply
	if err := json.Unmarshal(payload, &reply); err != nil {
		t.Fatalf("decode clock reply: %v", err)
	}
	if reply.ProbeID != probe.ProbeID || reply.ClientSentMs != probe.ClientSentMs {
		t.Fatalf("probe identity = %+v, want id=%d client=%v", reply, probe.ProbeID, probe.ClientSentMs)
	}
	if reply.ServerReceivedMs > reply.ServerSentMs {
		t.Fatalf("server receive time %v is after send time %v", reply.ServerReceivedMs, reply.ServerSentMs)
	}
}
