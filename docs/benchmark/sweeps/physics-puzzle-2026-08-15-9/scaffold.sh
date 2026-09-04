#!/bin/sh
set -e
node /home/joao/projects/threejs-webgpu/packages/create-threenative/dist/index.js "${1:-game}" --template starter --core-package /home/joao/projects/threenative-r8f-reseal-packages/threenative-core-0.1.0.tgz --physics-package /home/joao/projects/threenative-r8f-reseal-packages/threenative-physics-0.1.0.tgz --ui-package /home/joao/projects/threenative-r8f-reseal-packages/threenative-ui-0.1.12.tgz --playtest-package /home/joao/projects/threenative-r8f-reseal-packages/threenative-playtest-0.1.0.tgz --studio-package /home/joao/projects/threenative-r8f-reseal-packages/threenative-studio-0.1.0.tgz --cli-package /home/joao/projects/threenative-r8f-reseal-packages/create-threenative-0.1.0.tgz
cp brief.md "${1:-game}/brief.md"
cp reference.png "${1:-game}/reference.png"
cp sweep.json "${1:-game}/sweep.json"
