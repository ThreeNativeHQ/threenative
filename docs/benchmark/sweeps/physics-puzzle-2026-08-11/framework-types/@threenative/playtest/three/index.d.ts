import { a as IPlaytestBridgeV1, J as JsonValue, e as IPlaytestGameplayObservation } from '../protocol-C93FOGyC.js';
import { Object3D, Vector2, Camera, Scene } from 'three';

interface IThreePlaytestEntity {
    id: string;
    object: Object3D;
    path?: string;
}

interface ThreePlaytestRenderer {
    getDrawingBufferSize(target: Vector2): Vector2;
}

interface IThreePlaytestResources {
    read(): Record<string, JsonValue>;
    write?(id: string, path: string | undefined, value: JsonValue): boolean;
}
interface IThreePlaytestBridgeOptions {
    camera: Camera;
    components?: () => Record<string, Record<string, JsonValue>>;
    diagnostics?: () => JsonValue[];
    entities?: readonly IThreePlaytestEntity[] | (() => readonly IThreePlaytestEntity[]);
    fixedStep?: (ticks: number) => Promise<number | void> | number | void;
    gameplay?: () => IPlaytestGameplayObservation;
    gameplayChannels?: () => readonly ("runtime.contacts" | "runtime.tags")[];
    events?: () => JsonValue[];
    renderer: ThreePlaytestRenderer;
    resources?: IThreePlaytestResources;
    scene: Scene;
    tick?: () => number;
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

export { type IDeviceBridgeInstallation, type IThreePlaytestBridgeInstallation, type IThreePlaytestBridgeOptions, type IThreePlaytestEntity, type IThreePlaytestResources, connectDevicePlaytestBridge, installThreePlaytestBridge, readPlaytestEndpoint };
