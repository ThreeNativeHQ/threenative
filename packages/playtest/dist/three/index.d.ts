import { I as IPlaytestBridgeV1, J as JsonValue, P as PlaytestClockMode, a as IPlaytestSampleRequest, b as IPlaytestObservationSnapshot } from '../protocol-BmvPixRi.js';
import { Object3D, Camera, WebGLRenderer, Scene } from 'three';

interface IThreePlaytestEntity {
    id: string;
    object: Object3D;
    path?: string;
}
declare class ThreePlaytestEntityRegistry {
    #private;
    register(entry: IThreePlaytestEntity): void;
    get(id: string): Required<IThreePlaytestEntity> | undefined;
    select(ids?: readonly string[]): Required<IThreePlaytestEntity>[];
}
declare function objectPath(object: Object3D): string;

interface IThreePlaytestResources {
    read(): Record<string, JsonValue>;
    write?(id: string, path: string | undefined, value: JsonValue): boolean;
}
interface IThreePlaytestBridgeOptions {
    camera: Camera;
    diagnostics?: () => JsonValue[];
    entities?: readonly IThreePlaytestEntity[];
    fixedStep?: (ticks: number) => Promise<void> | void;
    renderer: WebGLRenderer;
    resources?: IThreePlaytestResources;
    scene: Scene;
}
interface IThreePlaytestBridgeInstallation {
    bridge: IPlaytestBridgeV1;
    dispose(): void;
    registerEntity(entry: IThreePlaytestEntity): void;
}
declare function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation;

interface IThreeObservationInput {
    camera: Camera;
    clockMode: PlaytestClockMode;
    diagnostics?: () => JsonValue[];
    registry: ThreePlaytestEntityRegistry;
    renderer: WebGLRenderer;
    resources?: () => Record<string, JsonValue>;
    scene: Scene;
    tick?: number;
}
declare function sampleThreeObservations(input: IThreeObservationInput, request: IPlaytestSampleRequest): IPlaytestObservationSnapshot;

export { type IThreeObservationInput, type IThreePlaytestBridgeInstallation, type IThreePlaytestBridgeOptions, type IThreePlaytestEntity, type IThreePlaytestResources, ThreePlaytestEntityRegistry, installThreePlaytestBridge, objectPath, sampleThreeObservations };
