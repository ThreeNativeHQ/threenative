import { u as PlaytestClockMode, r as JsonValue, l as IPlaytestObservationSnapshot, m as IPlaytestSampleRequest, e as IPlaytestBridgeV1, k as IPlaytestGameplayObservation } from '../protocol-CeC1lz_G.js';
import { Object3D, Camera, Vector2, Scene } from 'three';

interface IThreePlaytestEntity {
    id: string;
    object: Object3D;
    path?: string;
}
declare class ThreePlaytestEntityRegistry {
    #private;
    register(entry: IThreePlaytestEntity): void;
    get(id: string): Required<IThreePlaytestEntity> | undefined;
    replace(entries: readonly IThreePlaytestEntity[]): void;
    select(ids?: readonly string[]): Required<IThreePlaytestEntity>[];
}
declare function objectPath(object: Object3D): string;

interface IThreeObservationInput {
    camera: Camera;
    clockMode: PlaytestClockMode;
    diagnostics?: () => JsonValue[];
    registry: ThreePlaytestEntityRegistry;
    renderer: ThreePlaytestRenderer;
    resources?: () => Record<string, JsonValue>;
    scene: Scene;
    gameplay?: () => IPlaytestObservationSnapshot["gameplay"];
    tick?: number;
}
interface ThreePlaytestRenderer {
    getDrawingBufferSize(target: Vector2): Vector2;
}
declare function sampleThreeObservations(input: IThreeObservationInput, request: IPlaytestSampleRequest): IPlaytestObservationSnapshot;

interface IThreePlaytestResources {
    read(): Record<string, JsonValue>;
    write?(id: string, path: string | undefined, value: JsonValue): boolean;
}
interface IThreePlaytestBridgeOptions {
    camera: Camera;
    components?: () => Record<string, Record<string, JsonValue>>;
    diagnostics?: () => JsonValue[];
    entities?: readonly IThreePlaytestEntity[] | (() => readonly IThreePlaytestEntity[]);
    fixedStep?: (ticks: number) => Promise<void> | void;
    gameplay?: () => IPlaytestGameplayObservation;
    gameplayChannels?: () => readonly ("runtime.contacts" | "runtime.tags")[];
    events?: () => JsonValue[];
    renderer: ThreePlaytestRenderer;
    resources?: IThreePlaytestResources;
    scene: Scene;
}
interface IThreePlaytestBridgeInstallation {
    bridge: IPlaytestBridgeV1;
    dispose(): void;
    registerEntity(entry: IThreePlaytestEntity): void;
    syncEntities(): void;
}
declare function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation;

interface IDeviceBridgeInstallation {
    close(): void;
}
declare function connectDevicePlaytestBridge(bridge: IPlaytestBridgeV1, endpoint: string): IDeviceBridgeInstallation;
declare function readPlaytestEndpoint(): string | undefined;

export { type IDeviceBridgeInstallation, type IThreeObservationInput, type IThreePlaytestBridgeInstallation, type IThreePlaytestBridgeOptions, type IThreePlaytestEntity, type IThreePlaytestResources, ThreePlaytestEntityRegistry, type ThreePlaytestRenderer, connectDevicePlaytestBridge, installThreePlaytestBridge, objectPath, readPlaytestEndpoint, sampleThreeObservations };
