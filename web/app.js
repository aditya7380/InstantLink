/* InstantLink receiver page: plays a video the person picks on THEIR device. Nothing is uploaded:
   the file is only turned into a local blob: URL for the <video> element, and this page has no network code. */
(function () {
  'use strict';

  var STRINGS = {
    en: {
      playHeading: 'Watch a video from your device',
      playIntro: 'Choose a video from your phone or computer and play it right here. It plays straight from your device.',
      dropHint: 'Drop a video here, or',
      chooseBtn: 'Choose a video',
      privacyNote: 'Your video is not uploaded anywhere. This page has no upload code, and your browser is told to block network requests from it.',
      shareHeading: 'Share a video with someone else',
      shareBody: 'To make a link for a video on your computer, use the InstantLink desktop app: choose a video, click Create Link, and send the link. The video stays on your computer.',
      shareNote: 'That link works only while your computer is on, online, and InstantLink is open. This web page cannot create share links by itself.',
      langBtn: 'हिन्दी',
      langLabel: 'Change language to Hindi',
      loading: 'Loading {name}…',
      ready: 'Ready to play.',
      metaLine: '{name} · {size} · {type}',
      metaDuration: ' · {duration}',
      metaResolution: ' · {w}×{h}',
      notMedia: 'This does not look like a video or audio file: {name}',
      errAborted: 'Loading was stopped. Please choose the video again.',
      errNetwork: 'The video could not be read from your device. Please choose it again.',
      errDecode: 'Your browser found a problem decoding this video, so it cannot play it.',
      errUnsupported: 'Your browser cannot play this video format ({name}). Try an MP4 (H.264) or WebM file, or open it in another browser or app.',
      errNoPicture: 'The sound can play, but this browser cannot show the picture for this video format. Try an MP4 (H.264) or WebM file, or another browser.',
      errUnknown: 'This video could not be played.'
    },
    hi: {
      playHeading: 'अपने डिवाइस का वीडियो देखें',
      playIntro: 'अपने फ़ोन या कंप्यूटर से कोई वीडियो चुनें और यहीं चलाएँ। वीडियो सीधे आपके डिवाइस से चलता है।',
      dropHint: 'वीडियो यहाँ छोड़ें, या',
      chooseBtn: 'वीडियो चुनें',
      privacyNote: 'आपका वीडियो कहीं अपलोड नहीं होता। इस पेज में अपलोड का कोई कोड नहीं है, और ब्राउज़र को इससे नेटवर्क अनुरोध रोकने के लिए कहा गया है।',
      shareHeading: 'किसी और को वीडियो शेयर करें',
      shareBody: 'अपने कंप्यूटर के वीडियो का लिंक बनाने के लिए InstantLink डेस्कटॉप ऐप इस्तेमाल करें: वीडियो चुनें, Create Link दबाएँ और लिंक भेज दें। वीडियो आपके कंप्यूटर पर ही रहता है।',
      shareNote: 'वह लिंक तभी चलता है जब आपका कंप्यूटर चालू हो, इंटरनेट से जुड़ा हो और InstantLink खुला हो। यह वेब पेज अपने आप शेयर लिंक नहीं बना सकता।',
      langBtn: 'English',
      langLabel: 'भाषा बदलकर अंग्रेज़ी करें',
      loading: '{name} लोड हो रहा है…',
      ready: 'चलाने के लिए तैयार।',
      metaLine: '{name} · {size} · {type}',
      metaDuration: ' · {duration}',
      metaResolution: ' · {w}×{h}',
      notMedia: 'यह वीडियो या ऑडियो फ़ाइल नहीं लगती: {name}',
      errAborted: 'लोडिंग रुक गई। कृपया वीडियो दोबारा चुनें।',
      errNetwork: 'आपके डिवाइस से वीडियो पढ़ा नहीं जा सका। कृपया उसे दोबारा चुनें।',
      errDecode: 'आपके ब्राउज़र को इस वीडियो को डिकोड करने में समस्या आई, इसलिए वह इसे चला नहीं सकता।',
      errUnsupported: 'आपका ब्राउज़र यह वीडियो फ़ॉर्मेट ({name}) नहीं चला सकता। MP4 (H.264) या WebM फ़ाइल आज़माएँ, या इसे किसी दूसरे ब्राउज़र या ऐप में खोलें।',
      errNoPicture: 'आवाज़ चल सकती है, लेकिन यह ब्राउज़र इस फ़ॉर्मेट की तस्वीर नहीं दिखा सकता। MP4 (H.264) या WebM फ़ाइल आज़माएँ, या दूसरा ब्राउज़र इस्तेमाल करें।',
      errUnknown: 'यह वीडियो चलाया नहीं जा सका।'
    }
  };

  var MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|wav|ogg|opus)$/i;
  var $ = function (id) { return document.getElementById(id); };
  var lang = pickLanguage();
  var currentUrl = null;
  var currentFile = null;

  function pickLanguage() {
    var q = new URLSearchParams(window.location.search).get('lang');
    var l = (q || (navigator.language || 'en')).slice(0, 2).toLowerCase();
    return STRINGS[l] ? l : 'en';
  }

  function t(key, vars) {
    var s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] !== undefined ? vars[k] : ''; });
  }

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    var b = $('lang');
    b.textContent = t('langBtn');
    b.setAttribute('aria-label', t('langLabel'));
  }

  function formatSize(n) {
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
  }

  function formatDuration(sec) {
    if (!isFinite(sec)) return '';
    var s = Math.round(sec);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return h ? h + ':' + pad(m) + ':' + pad(r) : m + ':' + pad(r);
  }

  function show(id, text) {
    var el = $(id);
    el.textContent = text || '';
    el.hidden = !text;
  }

  function releasePrevious() {
    var v = $('video');
    v.pause();
    v.removeAttribute('src');
    v.load();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }

  function loadFile(file) {
    if (!file) return;
    show('error', '');
    show('status', '');
    releasePrevious();
    currentFile = file;
    var looksLikeMedia = /^(video|audio)\//.test(file.type) || MEDIA_EXT.test(file.name);
    if (!looksLikeMedia) {
      $('player').hidden = true;
      show('error', t('notMedia', { name: file.name }));
      return;
    }
    currentUrl = URL.createObjectURL(file); // local reference only: no bytes are read into memory or sent anywhere
    $('player').hidden = false;
    $('meta').textContent = t('metaLine', { name: file.name, size: formatSize(file.size), type: file.type || '?' });
    show('status', t('loading', { name: file.name }));
    $('video').src = currentUrl;
  }

  function onError() {
    var v = $('video');
    if (!v.getAttribute('src')) return; // we cleared it ourselves
    var code = v.error ? v.error.code : 0;
    var key = { 1: 'errAborted', 2: 'errNetwork', 3: 'errDecode', 4: 'errUnsupported' }[code] || 'errUnknown';
    show('status', '');
    show('error', t(key, { name: currentFile ? currentFile.name : '' }));
  }

  function onMetadata() {
    var v = $('video');
    var isVideoFile = currentFile && (currentFile.type.indexOf('video/') === 0 || /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(currentFile.name));
    if (isVideoFile && v.videoWidth === 0) {
      // Sound decodes but the picture codec is not supported (e.g. HEVC in some browsers).
      show('error', t('errNoPicture'));
    }
    var extra = t('metaDuration', { duration: formatDuration(v.duration) });
    if (v.videoWidth) extra += t('metaResolution', { w: v.videoWidth, h: v.videoHeight });
    $('meta').textContent = t('metaLine', { name: currentFile.name, size: formatSize(currentFile.size), type: currentFile.type || '?' }) + extra;
    show('status', t('ready'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyLanguage();
    $('lang').addEventListener('click', function () { lang = lang === 'en' ? 'hi' : 'en'; applyLanguage(); if (currentFile && !$('player').hidden) { $('meta').textContent = t('metaLine', { name: currentFile.name, size: formatSize(currentFile.size), type: currentFile.type || '?' }); } });
    $('file').addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
    // A file dropped outside the box must not make the browser navigate away to the file.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    $('video').addEventListener('error', onError);
    $('video').addEventListener('loadedmetadata', onMetadata);
  });
})();
