# CocoaPods spec of Metrolist's local Capacitor plugin for iOS (Capacitor 6 uses CocoaPods by default).
# `npx cap sync ios` adds `pod 'MetrolistCapacitorBackgroundPlayback', :path => '../../native/capacitor-background-playback'`
# to ios/App/Podfile (the pod name is the npm package name in Capacitor's naming) and lists
# BackgroundPlaybackPlugin in packageClassList (found by its @objc(...) name in ios/).
# Untested on a device: CI only compiles it for the simulator.
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'MetrolistCapacitorBackgroundPlayback'
  s.version = package['version']
  s.summary = 'Background play, lock-screen controls and ad blocking for the Metrolist iOS app.'
  s.description = package['description']
  s.license = { :type => 'Proprietary', :text => 'Part of Metrolist; not distributed on its own.' }
  s.homepage = 'https://github.com/hdmodha/metrolist-cross-platform'
  s.author = 'Metrolist contributors'
  s.source = { :git => 'https://github.com/hdmodha/metrolist-cross-platform.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.swift'
  # The page-visibility script is the Android plugin's asset (one copy for both platforms); the
  # content-blocker list is generated from src/shared/adBlock.ts by `npm run adblock:rules`.
  s.resource_bundles = {
    'MetrolistBackgroundPlayback' => [
      'android/src/main/assets/metrolist-page-visibility.js',
      'ios/Resources/metrolist-content-blocker.json'
    ]
  }
  s.ios.deployment_target = '13.0'
  s.frameworks = 'AVFoundation', 'MediaPlayer', 'WebKit', 'UIKit'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
