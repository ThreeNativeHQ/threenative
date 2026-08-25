#include "mystral/platform/ui_overlay.h"

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
 * **UNPROVEN.** No part of this file has been executed. It has never been compiled, launched, or
 * touched on a simulator or a device, because this repository has no macOS host. PRD-217's
 * acceptance criterion 6 asks for iOS to be "either proven or stated unproven", and this is the
 * statement: treat every claim in these comments as a design intent until a run says otherwise.
 */

namespace {

/** Must match `UI_BRIDGE_GLOBALS.uiHost` in @threenative/core/ui-layer. */
NSString* const kHostObject = @"tnHost";
/** Must match `HIT_REGIONS_MESSAGE`. */
NSString* const kHitRegions = @"tn:hit-regions";
/** The origin the UI is served from, chosen to look like the web build's rather than like a file. */
NSString* const kOrigin = @"threenative://localhost/";

}  // namespace

@interface TnUiSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, copy) NSString* root;
@end

@interface TnUiOverlayView : WKWebView
/** Published rectangles, normalized to the viewport, four floats each. */
@property(nonatomic, strong) NSArray<NSNumber*>* regions;
@end

@implementation TnUiSchemeHandler

- (void)webView:(WKWebView*)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSString* path = task.request.URL.path;
    if (path.length <= 1) path = @"/index.html";
    NSString* file = [self.root stringByAppendingPathComponent:path];
    // Refuse to leave the staged UI directory. The page is local and still the least trusted thing
    // in the process.
    if (![file.stringByStandardizingPath hasPrefix:self.root.stringByStandardizingPath]) {
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
@property(nonatomic, weak) TnUiOverlayView* overlay;
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
    UIWindow* window = nil;
    for (UIScene* scene in UIApplication.sharedApplication.connectedScenes.allObjects) {
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow* candidate in ((UIWindowScene*)scene).windows) {
            if (candidate.isKeyWindow) window = candidate;
        }
    }
    if (window == nil) {
        NSLog(@"TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"no key window\"}");
        return false;
    }

    WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
    TnUiSchemeHandler* handler = [[TnUiSchemeHandler alloc] init];
    handler.root = [NSString stringWithUTF8String:uiRoot.c_str()];
    [configuration setURLSchemeHandler:handler forURLScheme:@"threenative"];

    TnUiOverlayView* overlay = [[TnUiOverlayView alloc] initWithFrame:window.bounds
                                                        configuration:configuration];
    TnUiOverlayBridge* bridge = [[TnUiOverlayBridge alloc] init];
    bridge.overlay = overlay;
    [configuration.userContentController addScriptMessageHandler:bridge name:kHostObject];

    overlay.opaque = NO;
    overlay.backgroundColor = UIColor.clearColor;
    overlay.scrollView.backgroundColor = UIColor.clearColor;
    overlay.scrollView.scrollEnabled = NO;
    overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [window addSubview:overlay];
    [overlay loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:
        [kOrigin stringByAppendingString:@"index.html"]]]];

    g_overlay = overlay;
    setUiOverlayAttached(true);
    NSLog(@"TN_UI_OVERLAY:{\"attached\":true}");
    return true;
}

void detachIosUiOverlay() {
    [g_overlay removeFromSuperview];
    g_overlay = nil;
    setUiOverlayAttached(false);
}

/** Deliver one bridge frame to the page, through the global every host calls. */
bool postIosUiMessage(const std::string& frame) {
    if (g_overlay == nil) return false;
    NSString* payload = [NSString stringWithUTF8String:frame.c_str()];
    NSData* quoted = [NSJSONSerialization dataWithJSONObject:@[payload] options:0 error:nil];
    NSString* literal = [[NSString alloc] initWithData:quoted encoding:NSUTF8StringEncoding];
    // `[frame]` minus its brackets is the JSON string literal, so a quote or a newline in the
    // payload cannot end the expression.
    NSString* inner = [literal substringWithRange:NSMakeRange(1, literal.length - 2)];
    NSString* script = [NSString stringWithFormat:
        @"window.__tnUiReceive && window.__tnUiReceive(%@)", inner];
    [g_overlay evaluateJavaScript:script completionHandler:nil];
    return true;
}

}  // namespace platform
}  // namespace mystral
