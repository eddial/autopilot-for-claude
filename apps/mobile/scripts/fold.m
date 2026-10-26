// Sets the iPhone Duo simulator's hinge angle (0 closed, 180 flat) or orientation, with the
// vendor HID event Device Hub's controls send. Run inside the simulator with `simctl spawn`.
//   fold angle <degrees> | fold orient <portrait|landscape-left|landscape-right|pud>
#import <Foundation/Foundation.h>
#include <mach/mach_time.h>
#include <unistd.h>
typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
extern IOHIDEventRef IOHIDEventCreateVendorDefinedEvent(CFAllocatorRef, uint64_t, uint32_t, uint32_t, uint32_t, const uint8_t *, CFIndex, uint32_t);
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreateWithType(CFAllocatorRef, int, CFDictionaryRef);
extern void IOHIDEventSystemClientDispatchEvent(IOHIDEventSystemClientRef, IOHIDEventRef);
extern CFDataRef IOCFSerialize(CFTypeRef, CFOptionFlags);

int main(int argc, char **argv) {
  if (argc != 3) return 64;
  IOHIDEventSystemClientRef client = IOHIDEventSystemClientCreateWithType(NULL, 4, NULL);
  if (!client) return 1;
  BOOL angle = strcmp(argv[1], "angle") == 0;
  id value = angle ? (id)@(atof(argv[2])) : (id)@(argv[2]);
  NSDictionary *payload = @{@"provider": @"com.apple.Virtualization.VirtualMachines",
                            @"source": angle ? @"hinge-slider-control" : @"orientation-picker-control",
                            @"type": angle ? @"range" : @"enum", @"value": value};
  CFDataRef data = IOCFSerialize((__bridge CFTypeRef)payload, 1);
  IOHIDEventRef event = IOHIDEventCreateVendorDefinedEvent(NULL, mach_absolute_time(), 0xFF61, 0x5B, 0,
      CFDataGetBytePtr(data), CFDataGetLength(data), 0);
  IOHIDEventSystemClientDispatchEvent(client, event);
  usleep(50000);
  return 0;
}
