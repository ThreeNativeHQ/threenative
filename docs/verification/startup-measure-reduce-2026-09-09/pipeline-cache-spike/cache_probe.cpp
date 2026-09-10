extern "C" {
#include "wgpu.h"
}
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
static void check(bool value, const char* label) { if (!value) { std::fprintf(stderr,"FAIL %s\n",label); std::exit(1); } }
static void adapterReady(WGPURequestAdapterStatus status,WGPUAdapter value,WGPUStringView,void* out,void*) { check(status==WGPURequestAdapterStatus_Success,"request adapter"); *static_cast<WGPUAdapter*>(out)=value; }
static void deviceReady(WGPURequestDeviceStatus status,WGPUDevice value,WGPUStringView,void* out,void*) { check(status==WGPURequestDeviceStatus_Success,"request device"); *static_cast<WGPUDevice*>(out)=value; }
static void mapped(WGPUMapAsyncStatus status,WGPUStringView,void* out,void*) { check(status==WGPUMapAsyncStatus_Success,"map readback"); *static_cast<bool*>(out)=true; }
int main(int argc,char** argv) {
    check(argc==3,"usage: cache_probe store|load|disabled cache.bin");
    const std::string mode=argv[1]; check(mode=="store"||mode=="load"||mode=="disabled","mode");
    WGPUInstance instance=wgpuCreateInstance(nullptr); check(instance,"instance");
    WGPUAdapter adapter=nullptr; WGPURequestAdapterOptions options={}; options.backendType=WGPUBackendType_Vulkan;
    WGPURequestAdapterCallbackInfo ac={}; ac.callback=adapterReady; ac.userdata1=&adapter;
    wgpuInstanceRequestAdapter(instance,&options,ac); check(adapter,"adapter");
    WGPUAdapterInfo info={}; wgpuAdapterGetInfo(adapter,&info);
    std::printf("adapter=%.*s driver=%.*s\n",int(info.device.length),info.device.data,int(info.description.length),info.description.data);
    wgpuAdapterInfoFreeMembers(info);
    WGPUFeatureName feature=static_cast<WGPUFeatureName>(WGPUNativeFeature_PipelineCache);
    check(wgpuAdapterHasFeature(adapter,feature),"pipeline-cache feature");
    WGPUDeviceDescriptor dd={}; dd.requiredFeatureCount=1; dd.requiredFeatures=&feature;
    WGPURequestDeviceCallbackInfo dc={}; WGPUDevice device=nullptr; dc.callback=deviceReady; dc.userdata1=&device;
    wgpuAdapterRequestDevice(adapter,&dd,dc); check(device,"device");
    std::vector<uint8_t> input;
    if(mode=="load") { std::ifstream f(argv[2],std::ios::binary); check(bool(f),"cache file"); input={std::istreambuf_iterator<char>(f),{}}; check(!input.empty(),"nonempty cache input"); }
    WGPUPipelineCacheDescriptor cd={}; cd.data=input.data(); cd.size=input.size();
    WGPUPipelineCache cache=wgpuDeviceCreatePipelineCache(device,&cd); check(cache,"strict cache import/create");
    auto empty=wgpuPipelineCacheGetData(cache); const size_t before=empty.size; wgpuPipelineCacheDataFreeMembers(empty);
    const char* wgsl=R"(@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fs()->@location(0) vec4f { return vec4f(0.25,0.5,0.75,1); })";
    WGPUShaderSourceWGSL source={}; source.chain.sType=WGPUSType_ShaderSourceWGSL; source.code={wgsl,WGPU_STRLEN};
    WGPUShaderModuleDescriptor md={}; md.nextInChain=&source.chain;
    WGPUShaderModule module=wgpuDeviceCreateShaderModule(device,&md); check(module,"shader module");
    WGPUPipelineCacheExtras extra={}; extra.chain.sType=static_cast<WGPUSType>(WGPUSType_PipelineCacheExtras); extra.cache=cache;
    WGPUColorTargetState color={}; color.format=WGPUTextureFormat_RGBA8Unorm; color.writeMask=WGPUColorWriteMask_All;
    WGPUFragmentState fragment={}; fragment.module=module; fragment.entryPoint={"fs",WGPU_STRLEN}; fragment.targetCount=1; fragment.targets=&color;
    WGPURenderPipelineDescriptor pd={}; pd.nextInChain=mode=="disabled"?nullptr:&extra.chain; pd.vertex.module=module; pd.vertex.entryPoint={"vs",WGPU_STRLEN}; pd.primitive.topology=WGPUPrimitiveTopology_TriangleList; pd.multisample.count=1; pd.multisample.mask=0xffffffff; pd.fragment=&fragment;
    const auto start=std::chrono::steady_clock::now(); auto pipeline=wgpuDeviceCreateRenderPipeline(device,&pd); check(pipeline,"render pipeline");
    const double ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
    WGPUTextureDescriptor td={}; td.usage=WGPUTextureUsage_RenderAttachment|WGPUTextureUsage_CopySrc; td.dimension=WGPUTextureDimension_2D; td.size={32,32,1}; td.format=color.format; td.mipLevelCount=1; td.sampleCount=1;
    auto texture=wgpuDeviceCreateTexture(device,&td); auto view=wgpuTextureCreateView(texture,nullptr);
    WGPUBufferDescriptor bd={}; bd.size=256*32; bd.usage=WGPUBufferUsage_CopyDst|WGPUBufferUsage_MapRead; auto buffer=wgpuDeviceCreateBuffer(device,&bd);
    auto encoder=wgpuDeviceCreateCommandEncoder(device,nullptr);
    WGPURenderPassColorAttachment ca={}; ca.view=view; ca.depthSlice=WGPU_DEPTH_SLICE_UNDEFINED; ca.loadOp=WGPULoadOp_Clear; ca.storeOp=WGPUStoreOp_Store; ca.clearValue={0,0,0,1};
    WGPURenderPassDescriptor rd={}; rd.colorAttachmentCount=1; rd.colorAttachments=&ca;
    auto pass=wgpuCommandEncoderBeginRenderPass(encoder,&rd); wgpuRenderPassEncoderSetPipeline(pass,pipeline); wgpuRenderPassEncoderDraw(pass,3,1,0,0); wgpuRenderPassEncoderEnd(pass); wgpuRenderPassEncoderRelease(pass);
    WGPUTexelCopyTextureInfo src={}; src.texture=texture; src.aspect=WGPUTextureAspect_All;
    WGPUTexelCopyBufferInfo dst={}; dst.buffer=buffer; dst.layout.bytesPerRow=256; dst.layout.rowsPerImage=32;
    wgpuCommandEncoderCopyTextureToBuffer(encoder,&src,&dst,&td.size);
    auto command=wgpuCommandEncoderFinish(encoder,nullptr); auto queue=wgpuDeviceGetQueue(device); wgpuQueueSubmit(queue,1,&command);
    bool done=false; WGPUBufferMapCallbackInfo mc={}; mc.callback=mapped; mc.userdata1=&done;
    wgpuBufferMapAsync(buffer,WGPUMapMode_Read,0,bd.size,mc); wgpuDevicePoll(device,true,nullptr); check(done,"readback callback");
    const auto* pixel=static_cast<const uint8_t*>(wgpuBufferGetConstMappedRange(buffer,0,bd.size)); check(pixel,"readback");
    std::fprintf(stderr,"observed RGBA=%u,%u,%u,%u\n",pixel[0],pixel[1],pixel[2],pixel[3]); check(pixel[0]==64&&(pixel[1]==127||pixel[1]==128)&&pixel[2]==191&&pixel[3]==255,"expected rendered RGBA");
    std::ofstream image(mode+".rgba",std::ios::binary); image.write(reinterpret_cast<const char*>(pixel),bd.size); image.close();
    auto data=wgpuPipelineCacheGetData(cache); check(data.data&&data.size,"serialized data");
    std::printf("{\"mode\":\"%s\",\"strictLoadAccepted\":%s,\"attached\":%s,\"inputBytes\":%zu,\"beforeBytes\":%zu,\"outputBytes\":%zu,\"createMs\":%.6f,\"pixel\":[%u,%u,%u,%u]}\n",mode.c_str(),mode=="load"?"true":"false",mode!="disabled"?"true":"false",input.size(),before,data.size,ms,pixel[0],pixel[1],pixel[2],pixel[3]);
    if(mode=="store") { std::ofstream f(argv[2],std::ios::binary); f.write(reinterpret_cast<const char*>(data.data),data.size); check(bool(f),"write cache"); }
    wgpuPipelineCacheDataFreeMembers(data); wgpuBufferUnmap(buffer); wgpuBufferRelease(buffer); wgpuCommandBufferRelease(command); wgpuCommandEncoderRelease(encoder); wgpuTextureViewRelease(view); wgpuTextureRelease(texture); wgpuRenderPipelineRelease(pipeline); wgpuShaderModuleRelease(module); wgpuPipelineCacheRelease(cache); wgpuQueueRelease(queue); wgpuDeviceRelease(device); wgpuAdapterRelease(adapter); wgpuInstanceRelease(instance);
}
