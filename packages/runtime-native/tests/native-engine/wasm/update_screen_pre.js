// Lets the screen read TN_UPDATE_OBJECTS: Emscripten's ENV starts empty under node.
Module.preRun = [() => { Object.assign(ENV, process.env); }];
