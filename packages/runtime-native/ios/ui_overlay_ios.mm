#include "mystral/platform/ui_overlay.h"
#include "mystral/platform/window.h"
#include <SDL3/SDL.h>

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#include <string>
#include <vector>

/**
 * The UI layer on iOS — a transparent `WKWebView` composited over the game surface.
 *
 * Same shape as the Android host and the desktop one, and deliberately so: the page is served from
 * a real origin rather than `file://`, the bridge is a `MessagePort`-shaped channel, and the
 * interactive rectangles the page publishes decide which surface a touch belongs to. What differs
 * is only who provides each of those.
 *
 * - **Assets** come from a `WKURLSchemeHandler`, iOS's answer to `WebViewAssetLoader`. `file://`
 *   would work and would quietly stop `fetch` and module imports behaving as they do on web, which
 *   is the equivalence the whole PRD exists to keep.
 * - **The bridge** is `WKScriptMessageHandler` outbound and `evaluateJavaScript` inbound, calling
 *   the same `window.__tnUiReceive` every other host calls.
 * - **The hit test** is `hitTest:withEvent:`, overridden to return nil outside the published
 *   rectangles. UIKit then continues to the view behind — SDL's — which is the same rule Android
 *   gets from returning false out of `dispatchTouchEvent`, and the same rule X11 gets from an
 *   input shape. `pointer-events: none` is not the mechanism on any of the three.
 *
 * **UNPROVEN WebUI execution.** Native-only simulator smoke does not exercise this overlay.
 * The packaged React pixel proof must pass before claiming visible iOS UI; simulator screenshots
 * still do not establish physical-device input or presentation latency.
 */

namespace {

/** Must match `UI_BRIDGE_GLOBALS.uiHost` in @threenative/core/ui-layer. */
NSString* const kHostObject = @"tnHost";
/** Must match `HIT_REGIONS_MESSAGE`. */
NSString* const kHitRegions = @"tn:hit-regions";
/** The origin the UI is served from, chosen to look like the web build's rather than like a file. */
NSString* const kOrigin = @"threenative://localhost/";

static NSString* resolveUiFile(NSString* root, NSURL* url) {
    if (![url.scheme.lowercaseString isEqualToString:@"threenative"] ||
        ![url.host.lowercaseString isEqualToString:@"localhost"] || url.port != nil || url.user != nil ||
        url.password != nil)
        return nil;
    NSString* path = url.path;
    while ([path hasPrefix:@"/"])
        path = [path substringFromIndex:1];
    if (path.length == 0)
        path = @"index.html";
    NSString* resolvedRoot = root.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    NSString* file =
        [resolvedRoot stringByAppendingPathComponent:path].stringByStandardizingPath.stringByResolvingSymlinksInPath;
    return [file hasPrefix:[resolvedRoot stringByAppendingString:@"/"]] ? file : nil;
}

}  // namespace

@interface TnUiSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, copy) NSString* root;
@end

@interface TnUiOverlayView : WKWebView
/** Published rectangles, normalized to the viewport, four floats each. */
@property(nonatomic, strong) NSArray<NSNumber*>* regions;
@end

@implementation TnUiSchemeHandler

- (void)dealloc {
    [_root release];
    [super dealloc];
}

- (void)webView:(WKWebView*)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSString* file = resolveUiFile(self.root, task.request.URL);
    if (file == nil) {
        [task didFailWithError:[NSError errorWithDomain:@"TnUiOverlay" code:403 userInfo:nil]];
        return;
    }
    NSData* body = [NSData dataWithContentsOfFile:file];
    if (body == nil) {
        [task didFailWithError:[NSError errorWithDomain:@"TnUiOverlay" code:404 userInfo:nil]];
        return;
    }
    NSURLResponse* response = [[NSURLResponse alloc] initWithURL:task.request.URL
                                                       MIMEType:[TnUiSchemeHandler mimeTypeFor:file]
                                          expectedContentLength:body.length
                                               textEncodingName:@"utf-8"];
    [task didReceiveResponse:response];
    [response release];
    [task didReceiveData:body];
    [task didFinish];
}

- (void)webView:(WKWebView*)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {
}

/** A wrong type here is a stylesheet the page silently ignores, so the common ones are named. */
+ (NSString*)mimeTypeFor:(NSString*)path {
    NSString* extension = path.pathExtension.lowercaseString;
    if ([extension isEqualToString:@"html"]) return @"text/html";
    if ([extension isEqualToString:@"js"] || [extension isEqualToString:@"mjs"]) return @"text/javascript";
    if ([extension isEqualToString:@"css"]) return @"text/css";
    if ([extension isEqualToString:@"json"]) return @"application/json";
    if ([extension isEqualToString:@"svg"]) return @"image/svg+xml";
    if ([extension isEqualToString:@"png"]) return @"image/png";
    if ([extension isEqualToString:@"webp"]) return @"image/webp";
    if ([extension isEqualToString:@"woff2"]) return @"font/woff2";
    return @"application/octet-stream";
}

@end

@implementation TnUiOverlayView

- (void)dealloc {
    [_regions release];
    [super dealloc];
}

/**
 * The hit test, and the only place ownership is decided.
 *
 * Returning nil for a point outside every published rectangle makes UIKit continue to the view
 * behind this one — SDL's — and deliver the whole gesture there. Ownership therefore lands with
 * the first touch and stays, which is the rule a drag starting on the game needs in order not to
 * be stolen by a button it passes over.
 */
- (UIView*)hitTest:(CGPoint)point withEvent:(UIEvent*)event {
    if (self.regions.count < 4 || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
        return nil;
    }
    const CGFloat x = point.x / self.bounds.size.width;
    const CGFloat y = point.y / self.bounds.size.height;
    for (NSUInteger index = 0; index + 3 < self.regions.count; index += 4) {
        const CGFloat left = self.regions[index].doubleValue;
        const CGFloat top = self.regions[index + 1].doubleValue;
        const CGFloat width = self.regions[index + 2].doubleValue;
        const CGFloat height = self.regions[index + 3].doubleValue;
        if (x < left || y < top || x > left + width || y > top + height) continue;
        return [super hitTest:point withEvent:event];
    }
    return nil;
}

@end

@interface TnUiOverlayBridge : NSObject <WKScriptMessageHandler>
@property(nonatomic, assign) TnUiOverlayView* overlay;
@end

@implementation TnUiOverlayBridge

- (void)userContentController:(WKUserContentController*)controller
      didReceiveScriptMessage:(WKScriptMessage*)message {
    if (![message.body isKindOfClass:[NSString class]]) return;
    NSString* frame = (NSString*)message.body;
    if ([frame containsString:kHitRegions]) {
        [self applyHitRegions:frame];
        return;
    }
    mystral::platform::queueUiMessage(frame.UTF8String);
}

/**
 * Hit regions stop here: the host owns the hit test, and sending them on to the game would add a
 * hop to the input path for no reader. Same rule as the Android and desktop hosts.
 */
- (void)applyHitRegions:(NSString*)frame {
    NSError* error = nil;
    NSDictionary* parsed = [NSJSONSerialization
        JSONObjectWithData:[frame dataUsingEncoding:NSUTF8StringEncoding]
                   options:0
                     error:&error];
    NSArray* published = parsed[@"regions"];
    if (error != nil || ![published isKindOfClass:[NSArray class]]) {
        // Fail closed and loudly. Quietly ignoring a malformed publication leaves the previous
        // snapshot in place and decides every later touch against rectangles that no longer exist.
        NSLog(@"TN_UI_HIT_REGIONS_MALFORMED: %@", frame);
        return;
    }
    NSMutableArray<NSNumber*>* flat = [NSMutableArray arrayWithCapacity:published.count * 4];
    for (NSDictionary* region in published) {
        [flat addObject:region[@"x"] ?: @0];
        [flat addObject:region[@"y"] ?: @0];
        [flat addObject:region[@"width"] ?: @0];
        [flat addObject:region[@"height"] ?: @0];
    }
    self.overlay.regions = flat;
}

@end

namespace {

TnUiOverlayView* g_overlay = nil;

}  // namespace

namespace mystral {
namespace platform {

bool attachIosUiOverlay(const std::string& uiRoot) {
    if (![NSThread isMainThread]) {
        NSLog(@"TN_UI_OVERLAY_FAILED: UIKit requires the main thread");
        return false;
    }
    SDL_Window* sdlWindow = getSDLWindow();
    UIWindow* window = sdlWindow == nullptr
                           ? nil
                           : (UIWindow*)SDL_GetPointerProperty(SDL_GetWindowProperties(sdlWindow),
                                                               SDL_PROP_WINDOW_UIKIT_WINDOW_POINTER, nullptr);
    UIView* parent = window.rootViewController.view;
    if (parent == nil) {
        NSLog(@"TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"no SDL UIKit view\"}");
        return false;
    }

    WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
    TnUiSchemeHandler* handler = [[TnUiSchemeHandler alloc] init];
    handler.root = [NSString stringWithUTF8String:uiRoot.c_str()];
    [configuration setURLSchemeHandler:handler forURLScheme:@"threenative"];

    TnUiOverlayView* overlay = [[TnUiOverlayView alloc] initWithFrame:parent.bounds configuration:configuration];
    if (overlay == nil) {
        [handler release];
        [configuration release];
        return false;
    }
    TnUiOverlayBridge* bridge = [[TnUiOverlayBridge alloc] init];
    bridge.overlay = overlay;
    [configuration.userContentController addScriptMessageHandler:bridge name:kHostObject];

    overlay.opaque = NO;
    overlay.backgroundColor = UIColor.clearColor;
    overlay.scrollView.backgroundColor = UIColor.clearColor;
    overlay.scrollView.scrollEnabled = NO;
    overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [parent addSubview:overlay];
    [overlay loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:
        [kOrigin stringByAppendingString:@"index.html"]]]];

    g_overlay = overlay;
    [bridge release];
    [handler release];
    [configuration release];
    setUiOverlayAttached(true);
    NSLog(@"TN_UI_OVERLAY:{\"attached\":true}");
    return true;
}

void detachIosUiOverlay() {
    NSCAssert([NSThread isMainThread], @"UIKit requires the main thread");
    [g_overlay.configuration.userContentController removeScriptMessageHandlerForName:kHostObject];
    [g_overlay removeFromSuperview];
    [g_overlay release];
    g_overlay = nil;
    setUiOverlayAttached(false);
}

/** Deliver one bridge frame to the page, through the global every host calls. */
bool postIosUiMessage(const std::string& frame) {
    NSCAssert([NSThread isMainThread], @"WebKit requires the main thread");
    if (g_overlay == nil) return false;
    @autoreleasepool {
        NSString* payload = [NSString stringWithUTF8String:frame.c_str()];
        NSData* quoted = [NSJSONSerialization dataWithJSONObject:@[ payload ] options:0 error:nil];
        NSString* literal = [[[NSString alloc] initWithData:quoted encoding:NSUTF8StringEncoding] autorelease];
        // `[frame]` minus its brackets is the JSON string literal, so a quote or a newline in the
        // payload cannot end the expression.
        NSString* inner = [literal substringWithRange:NSMakeRange(1, literal.length - 2)];
        NSString* script = [NSString stringWithFormat:@"window.__tnUiReceive && window.__tnUiReceive(%@)", inner];
        [g_overlay evaluateJavaScript:script completionHandler:nil];
    }
    return true;
}

}  // namespace platform
}  // namespace mystral
