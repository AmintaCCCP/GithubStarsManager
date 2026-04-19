import React, { useState, useEffect } from 'react';
import { Save, X, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { Category } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';

// Complete emoji collection for categories
const availableIcons = [
  // 笑脸和人物
  { name: '😀', icon: '😀' },
  { name: '😃', icon: '😃' },
  { name: '😄', icon: '😄' },
  { name: '😁', icon: '😁' },
  { name: '😆', icon: '😆' },
  { name: '😅', icon: '😅' },
  { name: '🤣', icon: '🤣' },
  { name: '😂', icon: '😂' },
  { name: '🙂', icon: '🙂' },
  { name: '🙃', icon: '🙃' },
  { name: '😉', icon: '😉' },
  { name: '😊', icon: '😊' },
  { name: '😇', icon: '😇' },
  { name: '🥰', icon: '🥰' },
  { name: '😍', icon: '😍' },
  { name: '🤩', icon: '🤩' },
  { name: '😘', icon: '😘' },
  { name: '😗', icon: '😗' },
  { name: '😚', icon: '😚' },
  { name: '😙', icon: '😙' },
  { name: '🥲', icon: '🥲' },
  { name: '😋', icon: '😋' },
  { name: '😛', icon: '😛' },
  { name: '😜', icon: '😜' },
  { name: '🤪', icon: '🤪' },
  { name: '😝', icon: '😝' },
  { name: '🤑', icon: '🤑' },
  { name: '🤗', icon: '🤗' },
  { name: '🤭', icon: '🤭' },
  { name: '🤫', icon: '🤫' },
  { name: '🤔', icon: '🤔' },
  { name: '🤐', icon: '🤐' },
  { name: '🤨', icon: '🤨' },
  { name: '😐', icon: '😐' },
  { name: '😑', icon: '😑' },
  { name: '😶', icon: '😶' },
  { name: '😏', icon: '😏' },
  { name: '😒', icon: '😒' },
  { name: '🙄', icon: '🙄' },
  { name: '😬', icon: '😬' },
  { name: '🤥', icon: '🤥' },
  { name: '😔', icon: '😔' },
  { name: '😪', icon: '😪' },
  { name: '🤤', icon: '🤤' },
  { name: '😴', icon: '😴' },
  { name: '😷', icon: '😷' },
  { name: '🤒', icon: '🤒' },
  { name: '🤕', icon: '🤕' },
  { name: '🤢', icon: '🤢' },
  { name: '🤮', icon: '🤮' },
  { name: '🤧', icon: '🤧' },
  { name: '🥵', icon: '🥵' },
  { name: '🥶', icon: '🥶' },
  { name: '🥴', icon: '🥴' },
  { name: '😵', icon: '😵' },
  { name: '🤯', icon: '🤯' },
  { name: '🤠', icon: '🤠' },
  { name: '🥳', icon: '🥳' },
  { name: '🥸', icon: '🥸' },
  { name: '😎', icon: '😎' },
  { name: '🤓', icon: '🤓' },
  { name: '🧐', icon: '🧐' },
  { name: '😕', icon: '😕' },
  { name: '😟', icon: '😟' },
  { name: '🙁', icon: '🙁' },
  { name: '😮', icon: '😮' },
  { name: '😯', icon: '😯' },
  { name: '😲', icon: '😲' },
  { name: '😳', icon: '😳' },
  { name: '🥺', icon: '🥺' },
  { name: '😦', icon: '😦' },
  { name: '😧', icon: '😧' },
  { name: '😨', icon: '😨' },
  { name: '😰', icon: '😰' },
  { name: '😥', icon: '😥' },
  { name: '😢', icon: '😢' },
  { name: '😭', icon: '😭' },
  { name: '😱', icon: '😱' },
  { name: '😖', icon: '😖' },
  { name: '😣', icon: '😣' },
  { name: '😞', icon: '😞' },
  { name: '😓', icon: '😓' },
  { name: '😩', icon: '😩' },
  { name: '😫', icon: '😫' },
  { name: '🥱', icon: '🥱' },
  { name: '😤', icon: '😤' },
  { name: '😡', icon: '😡' },
  { name: '😠', icon: '😠' },
  { name: '🤬', icon: '🤬' },
  { name: '😈', icon: '😈' },
  { name: '👿', icon: '👿' },
  { name: '💀', icon: '💀' },
  { name: '☠️', icon: '☠️' },
  { name: '💩', icon: '💩' },
  { name: '🤡', icon: '🤡' },
  { name: '👹', icon: '👹' },
  { name: '👺', icon: '👺' },
  { name: '👻', icon: '👻' },
  { name: '👽', icon: '👽' },
  { name: '👾', icon: '👾' },
  { name: '🤖', icon: '🤖' },
  
  // 手势和身体部位
  { name: '👋', icon: '👋' },
  { name: '🤚', icon: '🤚' },
  { name: '🖐️', icon: '🖐️' },
  { name: '✋', icon: '✋' },
  { name: '🖖', icon: '🖖' },
  { name: '👌', icon: '👌' },
  { name: '🤌', icon: '🤌' },
  { name: '🤏', icon: '🤏' },
  { name: '✌️', icon: '✌️' },
  { name: '🤞', icon: '🤞' },
  { name: '🤟', icon: '🤟' },
  { name: '🤘', icon: '🤘' },
  { name: '🤙', icon: '🤙' },
  { name: '👈', icon: '👈' },
  { name: '👉', icon: '👉' },
  { name: '👆', icon: '👆' },
  { name: '🖕', icon: '🖕' },
  { name: '👇', icon: '👇' },
  { name: '☝️', icon: '☝️' },
  { name: '👍', icon: '👍' },
  { name: '👎', icon: '👎' },
  { name: '✊', icon: '✊' },
  { name: '👊', icon: '👊' },
  { name: '🤛', icon: '🤛' },
  { name: '🤜', icon: '🤜' },
  { name: '👏', icon: '👏' },
  { name: '🙌', icon: '🙌' },
  { name: '👐', icon: '👐' },
  { name: '🤲', icon: '🤲' },
  { name: '🤝', icon: '🤝' },
  { name: '🙏', icon: '🙏' },
  { name: '✍️', icon: '✍️' },
  { name: '💅', icon: '💅' },
  { name: '🤳', icon: '🤳' },
  { name: '💪', icon: '💪' },
  { name: '🦾', icon: '🦾' },
  { name: '🦿', icon: '🦿' },
  { name: '🦵', icon: '🦵' },
  { name: '🦶', icon: '🦶' },
  { name: '👂', icon: '👂' },
  { name: '🦻', icon: '🦻' },
  { name: '👃', icon: '👃' },
  { name: '🧠', icon: '🧠' },
  { name: '🫀', icon: '🫀' },
  { name: '🫁', icon: '🫁' },
  { name: '🦷', icon: '🦷' },
  { name: '🦴', icon: '🦴' },
  { name: '👀', icon: '👀' },
  { name: '👁️', icon: '👁️' },
  { name: '👅', icon: '👅' },
  { name: '👄', icon: '👄' },
  
  // 人物和职业
  { name: '👶', icon: '👶' },
  { name: '🧒', icon: '🧒' },
  { name: '👦', icon: '👦' },
  { name: '👧', icon: '👧' },
  { name: '🧑', icon: '🧑' },
  { name: '👱', icon: '👱' },
  { name: '👨', icon: '👨' },
  { name: '🧔', icon: '🧔' },
  { name: '👩', icon: '👩' },
  { name: '🧓', icon: '🧓' },
  { name: '👴', icon: '👴' },
  { name: '👵', icon: '👵' },
  { name: '🙍', icon: '🙍' },
  { name: '🙎', icon: '🙎' },
  { name: '🙅', icon: '🙅' },
  { name: '🙆', icon: '🙆' },
  { name: '💁', icon: '💁' },
  { name: '🙋', icon: '🙋' },
  { name: '🧏', icon: '🧏' },
  { name: '🙇', icon: '🙇' },
  { name: '🤦', icon: '🤦' },
  { name: '🤷', icon: '🤷' },
  { name: '👨‍⚕️', icon: '👨‍⚕️' },
  { name: '👩‍⚕️', icon: '👩‍⚕️' },
  { name: '👨‍🌾', icon: '👨‍🌾' },
  { name: '👩‍🌾', icon: '👩‍🌾' },
  { name: '👨‍🍳', icon: '👨‍🍳' },
  { name: '👩‍🍳', icon: '👩‍🍳' },
  { name: '👨‍🎓', icon: '👨‍🎓' },
  { name: '👩‍🎓', icon: '👩‍🎓' },
  { name: '👨‍🎤', icon: '👨‍🎤' },
  { name: '👩‍🎤', icon: '👩‍🎤' },
  { name: '👨‍🏫', icon: '👨‍🏫' },
  { name: '👩‍🏫', icon: '👩‍🏫' },
  { name: '👨‍🏭', icon: '👨‍🏭' },
  { name: '👩‍🏭', icon: '👩‍🏭' },
  { name: '👨‍💻', icon: '👨‍💻' },
  { name: '👩‍💻', icon: '👩‍💻' },
  { name: '👨‍💼', icon: '👨‍💼' },
  { name: '👩‍💼', icon: '👩‍💼' },
  { name: '👨‍🔧', icon: '👨‍🔧' },
  { name: '👩‍🔧', icon: '👩‍🔧' },
  { name: '👨‍🔬', icon: '👨‍🔬' },
  { name: '👩‍🔬', icon: '👩‍🔬' },
  { name: '👨‍🎨', icon: '👨‍🎨' },
  { name: '👩‍🎨', icon: '👩‍🎨' },
  { name: '👨‍🚒', icon: '👨‍🚒' },
  { name: '👩‍🚒', icon: '👩‍🚒' },
  { name: '👨‍✈️', icon: '👨‍✈️' },
  { name: '👩‍✈️', icon: '👩‍✈️' },
  { name: '👨‍🚀', icon: '👨‍🚀' },
  { name: '👩‍🚀', icon: '👩‍🚀' },
  { name: '👨‍⚖️', icon: '👨‍⚖️' },
  { name: '👩‍⚖️', icon: '👩‍⚖️' },
  { name: '👰', icon: '👰' },
  { name: '🤵', icon: '🤵' },
  { name: '👸', icon: '👸' },
  { name: '🤴', icon: '🤴' },
  { name: '🥷', icon: '🥷' },
  { name: '🦸', icon: '🦸' },
  { name: '🦹', icon: '🦹' },
  { name: '🧙', icon: '🧙' },
  { name: '🧚', icon: '🧚' },
  { name: '🧛', icon: '🧛' },
  { name: '🧜', icon: '🧜' },
  { name: '🧝', icon: '🧝' },
  { name: '🧞', icon: '🧞' },
  { name: '🧟', icon: '🧟' },
  { name: '💆', icon: '💆' },
  { name: '💇', icon: '💇' },
  { name: '🚶', icon: '🚶' },
  { name: '🧍', icon: '🧍' },
  { name: '🧎', icon: '🧎' },
  { name: '🏃', icon: '🏃' },
  { name: '💃', icon: '💃' },
  { name: '🕺', icon: '🕺' },
  { name: '🕴️', icon: '🕴️' },
  { name: '👯', icon: '👯' },
  { name: '🧖', icon: '🧖' },
  { name: '🧗', icon: '🧗' },
  { name: '🤺', icon: '🤺' },
  { name: '🏇', icon: '🏇' },
  { name: '⛷️', icon: '⛷️' },
  { name: '🏂', icon: '🏂' },
  { name: '🏌️', icon: '🏌️' },
  { name: '🏄', icon: '🏄' },
  { name: '🚣', icon: '🚣' },
  { name: '🏊', icon: '🏊' },
  { name: '⛹️', icon: '⛹️' },
  { name: '🏋️', icon: '🏋️' },
  { name: '🚴', icon: '🚴' },
  { name: '🚵', icon: '🚵' },
  { name: '🤸', icon: '🤸' },
  { name: '🤼', icon: '🤼' },
  { name: '🤽', icon: '🤽' },
  { name: '🤾', icon: '🤾' },
  { name: '🤹', icon: '🤹' },
  { name: '🧘', icon: '🧘' },
  { name: '🛀', icon: '🛀' },
  { name: '🛌', icon: '🛌' },
  
  // 文件和文档
  { name: '📁', icon: '📁' },
  { name: '📂', icon: '📂' },
  { name: '📄', icon: '📄' },
  { name: '📋', icon: '📋' },
  { name: '📊', icon: '📊' },
  { name: '📈', icon: '📈' },
  { name: '📉', icon: '📉' },
  { name: '📝', icon: '📝' },
  { name: '📚', icon: '📚' },
  { name: '📖', icon: '📖' },
  { name: '📑', icon: '📑' },
  { name: '🗂️', icon: '🗂️' },
  { name: '🗃️', icon: '🗃️' },
  { name: '🗄️', icon: '🗄️' },
  { name: '📇', icon: '📇' },
  
  // 技术和开发
  { name: '💻', icon: '💻' },
  { name: '🖥️', icon: '🖥️' },
  { name: '⌨️', icon: '⌨️' },
  { name: '🖱️', icon: '🖱️' },
  { name: '💾', icon: '💾' },
  { name: '💿', icon: '💿' },
  { name: '📀', icon: '📀' },
  { name: '🔧', icon: '🔧' },
  { name: '🔨', icon: '🔨' },
  { name: '⚙️', icon: '⚙️' },
  { name: '🛠️', icon: '🛠️' },
  { name: '🔩', icon: '🔩' },
  { name: '⚡', icon: '⚡' },
  { name: '🔌', icon: '🔌' },
  { name: '🔋', icon: '🔋' },
  { name: '🖨️', icon: '🖨️' },
  { name: '⌨️', icon: '⌨️' },
  { name: '🖱️', icon: '🖱️' },
  { name: '🖲️', icon: '🖲️' },
  
  // 网络和通信
  { name: '🌐', icon: '🌐' },
  { name: '🌍', icon: '🌍' },
  { name: '🌎', icon: '🌎' },
  { name: '🌏', icon: '🌏' },
  { name: '📡', icon: '📡' },
  { name: '📶', icon: '📶' },
  { name: '📱', icon: '📱' },
  { name: '📞', icon: '📞' },
  { name: '☎️', icon: '☎️' },
  { name: '📧', icon: '📧' },
  { name: '📨', icon: '📨' },
  { name: '📩', icon: '📩' },
  { name: '📬', icon: '📬' },
  { name: '📭', icon: '📭' },
  { name: '📮', icon: '📮' },
  { name: '📪', icon: '📪' },
  { name: '📫', icon: '📫' },
  { name: '📯', icon: '📯' },
  { name: '📢', icon: '📢' },
  { name: '📣', icon: '📣' },
  
  // 多媒体
  { name: '🎵', icon: '🎵' },
  { name: '🎶', icon: '🎶' },
  { name: '🎤', icon: '🎤' },
  { name: '🎧', icon: '🎧' },
  { name: '📻', icon: '📻' },
  { name: '📺', icon: '📺' },
  { name: '📹', icon: '📹' },
  { name: '📷', icon: '📷' },
  { name: '📸', icon: '📸' },
  { name: '🎥', icon: '🎥' },
  { name: '🎬', icon: '🎬' },
  { name: '🎭', icon: '🎭' },
  { name: '🎨', icon: '🎨' },
  { name: '🖌️', icon: '🖌️' },
  { name: '🖍️', icon: '🖍️' },
  { name: '✏️', icon: '✏️' },
  { name: '✒️', icon: '✒️' },
  { name: '🖊️', icon: '🖊️' },
  { name: '🖋️', icon: '🖋️' },
  { name: '🖍️', icon: '🖍️' },
  { name: '📐', icon: '📐' },
  { name: '📏', icon: '📏' },
  { name: '📌', icon: '📌' },
  { name: '📍', icon: '📍' },
  { name: '🖋️', icon: '🖋️' },
  
  // 游戏和娱乐
  { name: '🎮', icon: '🎮' },
  { name: '🕹️', icon: '🕹️' },
  { name: '🎯', icon: '🎯' },
  { name: '🎲', icon: '🎲' },
  { name: '🃏', icon: '🃏' },
  { name: '🎰', icon: '🎰' },
  { name: '🎪', icon: '🎪' },
  { name: '🎨', icon: '🎨' },
  { name: '🎭', icon: '🎭' },
  { name: '🎪', icon: '🎪' },
  { name: '🎨', icon: '🎨' },
  
  // 安全和保护
  // 安全和保护
  { name: '🔒', icon: '🔒' },
  { name: '🔓', icon: '🔓' },
  { name: '🔐', icon: '🔐' },
  { name: '🔑', icon: '🔑' },
  { name: '🗝️', icon: '🗝️' },
  { name: '🛡️', icon: '🛡️' },
  { name: '🔰', icon: '🔰' },
  { name: '⚔️', icon: '⚔️' },
  
  // 搜索和导航
  { name: '🔍', icon: '🔍' },
  { name: '🔎', icon: '🔎' },
  { name: '🧭', icon: '🧭' },
  { name: '🗺️', icon: '🗺️' },
  { name: '📍', icon: '📍' },
  { name: '📌', icon: '📌' },
  { name: '📎', icon: '📎' },
  { name: '🔗', icon: '🔗' },
  { name: '⛓️', icon: '⛓️' },
  { name: '🧭', icon: '🧭' },
  
  // 云和存储
  { name: '☁️', icon: '☁️' },
  { name: '⛅', icon: '⛅' },
  { name: '🌤️', icon: '🌤️' },
  { name: '📦', icon: '📦' },
  { name: '📫', icon: '📫' },
  { name: '🗳️', icon: '🗳️' },
  { name: '🗂️', icon: '🗂️' },
  { name: '🗃️', icon: '🗃️' },
  { name: '🗄️', icon: '🗄️' },
  { name: '🗑️', icon: '🗑️' },
  
  // 人物和社交
  { name: '👤', icon: '👤' },
  { name: '👥', icon: '👥' },
  { name: '👨‍💻', icon: '👨‍💻' },
  { name: '👩‍💻', icon: '👩‍💻' },
  { name: '🤖', icon: '🤖' },
  { name: '👾', icon: '👾' },
  { name: '👥', icon: '👥' },
  { name: '👪', icon: '👪' },
  { name: '👫', icon: '👫' },
  { name: '👬', icon: '👬' },
  
  // 符号和标记
  { name: '⭐', icon: '⭐' },
  { name: '🌟', icon: '🌟' },
  { name: '✨', icon: '✨' },
  { name: '💫', icon: '💫' },
  { name: '❤️', icon: '❤️' },
  { name: '💙', icon: '💙' },
  { name: '💚', icon: '💚' },
  { name: '💛', icon: '💛' },
  { name: '🧡', icon: '🧡' },
  { name: '💜', icon: '💜' },
  { name: '🖤', icon: '🖤' },
  { name: '🤍', icon: '🤍' },
  { name: '💯', icon: '💯' },
  { name: '✅', icon: '✅' },
  { name: '❌', icon: '❌' },
  { name: '⚠️', icon: '⚠️' },
  { name: '🚀', icon: '🚀' },
  { name: '🎉', icon: '🎉' },
  { name: '🎊', icon: '🎊' },
  { name: '🔥', icon: '🔥' },
  { name: '💎', icon: '💎' },
  { name: '🏆', icon: '🏆' },
  { name: '🥇', icon: '🥇' },
  { name: '🥈', icon: '🥈' },
  { name: '🥉', icon: '🥉' },
  { name: '🏅', icon: '🏅' },
  
  // 箭头和方向
  { name: '⬆️', icon: '⬆️' },
  { name: '⬇️', icon: '⬇️' },
  { name: '⬅️', icon: '⬅️' },
  { name: '➡️', icon: '➡️' },
  { name: '↗️', icon: '↗️' },
  { name: '↘️', icon: '↘️' },
  { name: '↙️', icon: '↙️' },
  { name: '↖️', icon: '↖️' },
  { name: '🔄', icon: '🔄' },
  { name: '🔃', icon: '🔃' },
  { name: '🔁', icon: '🔁' },
  { name: '🔂', icon: '🔂' },
  { name: '⤴️', icon: '⤴️' },
  { name: '⤵️', icon: '⤵️' },
  { name: '🔀', icon: '🔀' },
  { name: '🔄', icon: '🔄' },
  { name: '🔃', icon: '🔃' },
  { name: '🔁', icon: '🔁' },
  { name: '🔂', icon: '🔂' },
  { name: '▶️', icon: '▶️' },
  
  // 其他常用
  { name: '📅', icon: '📅' },
  { name: '📆', icon: '📆' },
  { name: '🗓️', icon: '🗓️' },
  { name: '⏰', icon: '⏰' },
  { name: '⏱️', icon: '⏱️' },
  { name: '⏲️', icon: '⏲️' },
  { name: '🕐', icon: '🕐' },
  { name: '📐', icon: '📐' },
  { name: '📏', icon: '📏' },
  { name: '♻️', icon: '♻️' },
  { name: '🔄', icon: '🔄' },
  { name: '➕', icon: '➕' },
  { name: '➖', icon: '➖' },
  { name: '✖️', icon: '✖️' },
  { name: '➗', icon: '➗' },
  { name: '🟢', icon: '🟢' },
  { name: '🔴', icon: '🔴' },
  { name: '🟡', icon: '🟡' },
  { name: '🔵', icon: '🔵' },
  { name: '🟣', icon: '🟣' },
  { name: '🟠', icon: '🟠' },
  { name: '⚫', icon: '⚫' },
  { name: '⚪', icon: '⚪' },
  
  // 动物和自然
  { name: '🐶', icon: '🐶' },
  { name: '🐱', icon: '🐱' },
  { name: '🐭', icon: '🐭' },
  { name: '🐹', icon: '🐹' },
  { name: '🐰', icon: '🐰' },
  { name: '🦊', icon: '🦊' },
  { name: '🐻', icon: '🐻' },
  { name: '🐼', icon: '🐼' },
  { name: '🐨', icon: '🐨' },
  { name: '🐯', icon: '🐯' },
  { name: '🦁', icon: '🦁' },
  { name: '🐮', icon: '🐮' },
  { name: '🐷', icon: '🐷' },
  { name: '🐽', icon: '🐽' },
  { name: '🐸', icon: '🐸' },
  { name: '🐵', icon: '🐵' },
  { name: '🙈', icon: '🙈' },
  { name: '🙉', icon: '🙉' },
  { name: '🙊', icon: '🙊' },
  { name: '🐒', icon: '🐒' },
  { name: '🐔', icon: '🐔' },
  { name: '🐧', icon: '🐧' },
  { name: '🐦', icon: '🐦' },
  { name: '🐤', icon: '🐤' },
  { name: '🐣', icon: '🐣' },
  { name: '🐥', icon: '🐥' },
  { name: '🦆', icon: '🦆' },
  { name: '🦅', icon: '🦅' },
  { name: '🦉', icon: '🦉' },
  { name: '🦇', icon: '🦇' },
  { name: '🐺', icon: '🐺' },
  { name: '🐗', icon: '🐗' },
  { name: '🐴', icon: '🐴' },
  { name: '🦄', icon: '🦄' },
  { name: '🐝', icon: '🐝' },
  { name: '🐛', icon: '🐛' },
  { name: '🦋', icon: '🦋' },
  { name: '🐌', icon: '🐌' },
  { name: '🐞', icon: '🐞' },
  { name: '🐜', icon: '🐜' },
  { name: '🦟', icon: '🦟' },
  { name: '🦗', icon: '🦗' },
  { name: '🕷️', icon: '🕷️' },
  { name: '🕸️', icon: '🕸️' },
  { name: '🦂', icon: '🦂' },
  { name: '🐢', icon: '🐢' },
  { name: '🐍', icon: '🐍' },
  { name: '🦎', icon: '🦎' },
  { name: '🦖', icon: '🦖' },
  { name: '🦕', icon: '🦕' },
  { name: '🐙', icon: '🐙' },
  { name: '🦑', icon: '🦑' },
  { name: '🦐', icon: '🦐' },
  { name: '🦞', icon: '🦞' },
  { name: '🦀', icon: '🦀' },
  { name: '🐡', icon: '🐡' },
  { name: '🐠', icon: '🐠' },
  { name: '🐟', icon: '🐟' },
  { name: '🐬', icon: '🐬' },
  { name: '🐳', icon: '🐳' },
  { name: '🐋', icon: '🐋' },
  { name: '🦈', icon: '🦈' },
  { name: '🐊', icon: '🐊' },
  { name: '🐅', icon: '🐅' },
  { name: '🐆', icon: '🐆' },
  { name: '🦓', icon: '🦓' },
  { name: '🦍', icon: '🦍' },
  { name: '🦧', icon: '🦧' },
  { name: '🐘', icon: '🐘' },
  { name: '🦛', icon: '🦛' },
  { name: '🦏', icon: '🦏' },
  { name: '🐪', icon: '🐪' },
  { name: '🐫', icon: '🐫' },
  { name: '🦒', icon: '🦒' },
  { name: '🦘', icon: '🦘' },
  { name: '🐃', icon: '🐃' },
  { name: '🐂', icon: '🐂' },
  { name: '🐄', icon: '🐄' },
  { name: '🐎', icon: '🐎' },
  { name: '🐖', icon: '🐖' },
  { name: '🐏', icon: '🐏' },
  { name: '🐑', icon: '🐑' },
  { name: '🦙', icon: '🦙' },
  { name: '🐐', icon: '🐐' },
  { name: '🦌', icon: '🦌' },
  { name: '🐕', icon: '🐕' },
  { name: '🐩', icon: '🐩' },
  { name: '🦮', icon: '🦮' },
  { name: '🐕‍🦺', icon: '🐕‍🦺' },
  { name: '🐈', icon: '🐈' },
  { name: '🐈‍⬛', icon: '🐈‍⬛' },
  { name: '🐓', icon: '🐓' },
  { name: '🦃', icon: '🦃' },
  { name: '🦚', icon: '🦚' },
  { name: '🦜', icon: '🦜' },
  { name: '🦢', icon: '🦢' },
  { name: '🦩', icon: '🦩' },
  { name: '🕊️', icon: '🕊️' },
  { name: '🐇', icon: '🐇' },
  { name: '🦝', icon: '🦝' },
  { name: '🦨', icon: '🦨' },
  { name: '🦡', icon: '🦡' },
  { name: '🦦', icon: '🦦' },
  { name: '🦥', icon: '🦥' },
  { name: '🐁', icon: '🐁' },
  { name: '🐀', icon: '🐀' },
  { name: '🐿️', icon: '🐿️' },
  { name: '🦔', icon: '🦔' },
  
  // 植物和食物
  { name: '🌲', icon: '🌲' },
  { name: '🌳', icon: '🌳' },
  { name: '🌴', icon: '🌴' },
  { name: '🌵', icon: '🌵' },
  { name: '🌶️', icon: '🌶️' },
  { name: '🍄', icon: '🍄' },
  { name: '🌰', icon: '🌰' },
  { name: '🌱', icon: '🌱' },
  { name: '🌿', icon: '🌿' },
  { name: '☘️', icon: '☘️' },
  { name: '🍀', icon: '🍀' },
  { name: '🎋', icon: '🎋' },
  { name: '🎍', icon: '🎍' },
  { name: '🍎', icon: '🍎' },
  { name: '🍊', icon: '🍊' },
  { name: '🍋', icon: '🍋' },
  { name: '🍌', icon: '🍌' },
  { name: '🍉', icon: '🍉' },
  { name: '🍇', icon: '🍇' },
  { name: '🍓', icon: '🍓' },
  { name: '🫐', icon: '🫐' },
  { name: '🍈', icon: '🍈' },
  { name: '🍒', icon: '🍒' },
  { name: '🍑', icon: '🍑' },
  { name: '🥭', icon: '🥭' },
  { name: '🍍', icon: '🍍' },
  { name: '🥥', icon: '🥥' },
  { name: '🥝', icon: '🥝' },
  { name: '🍅', icon: '🍅' },
  { name: '🍆', icon: '🍆' },
  { name: '🥑', icon: '🥑' },
  { name: '🥦', icon: '🥦' },
  { name: '🥬', icon: '🥬' },
  { name: '🥒', icon: '🥒' },
  { name: '🌶️', icon: '🌶️' },
  { name: '🫑', icon: '🫑' },
  { name: '🌽', icon: '🌽' },
  { name: '🥕', icon: '🥕' },
  { name: '🫒', icon: '🫒' },
  { name: '🧄', icon: '🧄' },
  { name: '🧅', icon: '🧅' },
  { name: '🥔', icon: '🥔' },
  { name: '🍠', icon: '🍠' },
  { name: '🥐', icon: '🥐' },
  { name: '🥖', icon: '🥖' },
  { name: '🍞', icon: '🍞' },
  { name: '🥨', icon: '🥨' },
  { name: '🥯', icon: '🥯' },
  { name: '🥞', icon: '🥞' },
  { name: '🧇', icon: '🧇' },
  { name: '🧀', icon: '🧀' },
  { name: '🍖', icon: '🍖' },
  { name: '🍗', icon: '🍗' },
  { name: '🥩', icon: '🥩' },
  { name: '🥓', icon: '🥓' },
  { name: '🍔', icon: '🍔' },
  { name: '🍟', icon: '🍟' },
  { name: '🍕', icon: '🍕' },
  { name: '🌭', icon: '🌭' },
  { name: '🥪', icon: '🥪' },
  { name: '🌮', icon: '🌮' },
  { name: '🌯', icon: '🌯' },
  { name: '🫔', icon: '🫔' },
  { name: '🥙', icon: '🥙' },
  { name: '🧆', icon: '🧆' },
  { name: '🥚', icon: '🥚' },
  { name: '🍳', icon: '🍳' },
  { name: '🥘', icon: '🥘' },
  { name: '🍲', icon: '🍲' },
  { name: '🫕', icon: '🫕' },
  { name: '🥣', icon: '🥣' },
  { name: '🥗', icon: '🥗' },
  { name: '🍿', icon: '🍿' },
  { name: '🧈', icon: '🧈' },
  { name: '🧂', icon: '🧂' },
  { name: '🥫', icon: '🥫' },
  { name: '🍱', icon: '🍱' },
  { name: '🍘', icon: '🍘' },
  { name: '🍙', icon: '🍙' },
  { name: '🍚', icon: '🍚' },
  { name: '🍛', icon: '🍛' },
  { name: '🍜', icon: '🍜' },
  { name: '🍝', icon: '🍝' },
  { name: '🍠', icon: '🍠' },
  { name: '🍢', icon: '🍢' },
  { name: '🍣', icon: '🍣' },
  { name: '🍤', icon: '🍤' },
  { name: '🍥', icon: '🍥' },
  { name: '🥮', icon: '🥮' },
  { name: '🍡', icon: '🍡' },
  { name: '🥟', icon: '🥟' },
  { name: '🥠', icon: '🥠' },
  { name: '🥡', icon: '🥡' },
  
  // 交通工具
  { name: '🚗', icon: '🚗' },
  { name: '🚕', icon: '🚕' },
  { name: '🚙', icon: '🚙' },
  { name: '🚌', icon: '🚌' },
  { name: '🚎', icon: '🚎' },
  { name: '🏎️', icon: '🏎️' },
  { name: '🚓', icon: '🚓' },
  { name: '🚑', icon: '🚑' },
  { name: '🚒', icon: '🚒' },
  { name: '🚐', icon: '🚐' },
  { name: '🛻', icon: '🛻' },
  { name: '🚚', icon: '🚚' },
  { name: '🚛', icon: '🚛' },
  { name: '🚜', icon: '🚜' },
  { name: '🏍️', icon: '🏍️' },
  { name: '🛵', icon: '🛵' },
  { name: '🚲', icon: '🚲' },
  { name: '🛴', icon: '🛴' },
  { name: '🛹', icon: '🛹' },
  { name: '🛼', icon: '🛼' },
  { name: '🚁', icon: '🚁' },
  { name: '🛸', icon: '🛸' },
  { name: '✈️', icon: '✈️' },
  { name: '🛩️', icon: '🛩️' },
  { name: '🛫', icon: '🛫' },
  { name: '🛬', icon: '🛬' },
  { name: '🪂', icon: '🪂' },
  { name: '💺', icon: '💺' },
  { name: '🚀', icon: '🚀' },
  { name: '🛰️', icon: '🛰️' },
  { name: '🚉', icon: '🚉' },
  { name: '🚞', icon: '🚞' },
  { name: '🚝', icon: '🚝' },
  { name: '🚄', icon: '🚄' },
  { name: '🚅', icon: '🚅' },
  { name: '🚈', icon: '🚈' },
  { name: '🚂', icon: '🚂' },
  { name: '🚆', icon: '🚆' },
  { name: '🚇', icon: '🚇' },
  { name: '🚊', icon: '🚊' },
  { name: '🚋', icon: '🚋' },
  { name: '🚃', icon: '🚃' },
  { name: '🚋', icon: '🚋' },
  { name: '🚎', icon: '🚎' },
  { name: '🚐', icon: '🚐' },
  { name: '🚑', icon: '🚑' },
  { name: '🚒', icon: '🚒' },
  { name: '🚓', icon: '🚓' },
  { name: '🚔', icon: '🚔' },
  { name: '🚕', icon: '🚕' },
  { name: '🚖', icon: '🚖' },
  { name: '🚗', icon: '🚗' },
  { name: '🚘', icon: '🚘' },
  { name: '🚙', icon: '🚙' },
  { name: '🛻', icon: '🛻' },
  { name: '🚚', icon: '🚚' },
  { name: '🚛', icon: '🚛' },
  { name: '🚜', icon: '🚜' },
  { name: '🏎️', icon: '🏎️' },
  { name: '🏍️', icon: '🏍️' },
  { name: '🛵', icon: '🛵' },
  { name: '🦽', icon: '🦽' },
  { name: '🦼', icon: '🦼' },
  { name: '🛺', icon: '🛺' },
  { name: '🚲', icon: '🚲' },
  { name: '🛴', icon: '🛴' },
  { name: '🛹', icon: '🛹' },
  { name: '🛼', icon: '🛼' },
  { name: '🚏', icon: '🚏' },
  { name: '🛣️', icon: '🛣️' },
  { name: '🛤️', icon: '🛤️' },
  { name: '🛢️', icon: '🛢️' },
  { name: '⛽', icon: '⛽' },
  { name: '🚨', icon: '🚨' },
  { name: '🚥', icon: '🚥' },
  { name: '🚦', icon: '🚦' },
  { name: '🛑', icon: '🛑' },
  { name: '🚧', icon: '🚧' },
  { name: '⚓', icon: '⚓' },
  { name: '⛵', icon: '⛵' },
  { name: '🛶', icon: '🛶' },
  { name: '🚤', icon: '🚤' },
  { name: '🛳️', icon: '🛳️' },
  { name: '⛴️', icon: '⛴️' },
  { name: '🚢', icon: '🚢' },
];

interface CategoryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: Category | null;
  isCreating?: boolean;
}

export const CategoryEditModal: React.FC<CategoryEditModalProps> = ({
  isOpen,
  onClose,
  category,
  isCreating = false
}) => {
  const { addCustomCategory, updateCustomCategory, updateDefaultCategory, resetDefaultCategory, resetDefaultCategoryNameIcon, resetDefaultCategoryKeywords, defaultCategoryOverrides, language } = useAppStore();

  const originalDefaultCategories = getAllCategories([], language, [], {});
  const isDefaultCategoryModified = category && !category.isCustom && category.id in defaultCategoryOverrides;
  const originalCategory = category && !category.isCustom ? originalDefaultCategories.find(c => c.id === category.id) : null;
  
  const hasNameIconModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    (defaultCategoryOverrides[category.id].name !== undefined || defaultCategoryOverrides[category.id].icon !== undefined);
  const hasKeywordsModified = category && !category.isCustom && defaultCategoryOverrides[category.id] && 
    defaultCategoryOverrides[category.id].keywords !== undefined;
  
  const [formData, setFormData] = useState({
    name: '',
    icon: 'Folder',
    keywords: ''
  });
  const [customIcon, setCustomIcon] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    if (category && !isCreating) {
      setFormData({
        name: category.name,
        icon: category.icon,
        keywords: category.keywords.join(', ')
      });
    } else if (isCreating) {
      setFormData({
        name: '',
        icon: '📁',
        keywords: ''
      });
    }
  }, [category, isCreating, isOpen]);

  const handleSave = () => {
    if (!formData.name.trim()) {
      alert(language === 'zh' ? '请输入分类名称' : 'Please enter category name');
      return;
    }

    if (isCreating) {
      const categoryData: Category = {
        id: Date.now().toString(),
        name: formData.name.trim(),
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
        isCustom: true
      };
      addCustomCategory(categoryData);
    } else if (category) {
      const updates = {
        name: formData.name.trim(),
        icon: formData.icon,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(k => k),
      };
      if (category.isCustom) {
        updateCustomCategory(category.id, updates);
      } else {
        updateDefaultCategory(category.id, updates);
      }
    }

    onClose();
  };

  const hasChanges = isCreating 
    ? formData.name.trim().length > 0
    : category && (
        formData.name !== category.name ||
        formData.icon !== category.icon ||
        formData.keywords !== (category.keywords?.join(', ') || '')
      );

  const handleIconSelect = (iconValue: string) => {
    setFormData(prev => ({ ...prev, icon: iconValue }));
    setShowCustomInput(false);
    setCustomIcon('');
  };

  const handleCustomIconSubmit = () => {
    if (customIcon.trim()) {
      setFormData(prev => ({ ...prev, icon: customIcon.trim() }));
      setShowCustomInput(false);
      setCustomIcon('');
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      icon: 'Folder',
      keywords: ''
    });
    setCustomIcon('');
    setShowCustomInput(false);
    onClose();
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isCreating ? t('添加分类', 'Add Category') : t('编辑分类', 'Edit Category')}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* Category Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('分类名称', 'Category Name')} *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t('输入分类名称', 'Enter category name')}
            autoFocus
          />
        </div>

        {/* Icon Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('选择图标', 'Select Icon')} 
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              ({availableIcons.length}+ {t('个可选', 'available')})
            </span>
          </label>
          
          {/* Custom Icon Input */}
          {showCustomInput && (
            <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={customIcon}
                  onChange={(e) => setCustomIcon(e.target.value)}
                  placeholder={t('输入任意emoji...', 'Enter any emoji...')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center text-lg"
                  maxLength={4}
                  autoFocus
                />
                <button
                  onClick={handleCustomIconSubmit}
                  disabled={!customIcon.trim()}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('确定', 'OK')}
                </button>
                <button
                  onClick={() => {
                    setShowCustomInput(false);
                    setCustomIcon('');
                  }}
                  className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                >
                  {t('取消', 'Cancel')}
                </button>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                {t('提示：可以输入任何emoji表情，如 🎯 🎨 🎪 等', 'Tip: You can enter any emoji, like 🎯 🎨 🎪 etc.')}
              </p>
            </div>
          )}
          
          <div className="grid grid-cols-8 gap-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-3">
            {availableIcons.map((iconItem) => (
              <button
                key={iconItem.name}
                onClick={() => handleIconSelect(iconItem.icon)}
                className={`p-2 rounded-lg text-xl hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${
                  formData.icon === iconItem.icon
                    ? 'bg-blue-100 dark:bg-blue-900 ring-2 ring-blue-500'
                    : 'bg-gray-50 dark:bg-gray-700'
                }`}
                title={iconItem.icon}
              >
                {iconItem.icon}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('当前选择:', 'Selected:')} {formData.icon}
            <button
              onClick={() => setShowCustomInput(true)}
              className="ml-3 text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Plus className="w-3 h-3 inline mr-1" />
              {t('自定义emoji', 'Custom emoji')}
            </button>
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t(
              '包含所有常用emoji分类：笑脸、人物、手势、动物、食物、交通、符号等',
              'Includes all common emoji categories: smileys, people, gestures, animals, food, transport, symbols, etc.'
            )}
          </p>
        </div>

        {/* Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('关键词', 'Keywords')}
          </label>
          <input
            type="text"
            value={formData.keywords}
            onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t('用逗号分隔关键词', 'Comma-separated keywords')}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('用于自动匹配仓库到此分类', 'Used to automatically match repositories to this category')}
          </p>
        </div>

        {/* Default Category Modified Hint */}
        {category && !category.isCustom && isDefaultCategoryModified && originalCategory && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
              {t(
                `此默认分类已被修改。原始值：${originalCategory.icon} ${originalCategory.name}`,
                `This default category has been modified. Original: ${originalCategory.icon} ${originalCategory.name}`
              )}
            </p>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-yellow-600 dark:text-yellow-400">{t('还原:', 'Reset:')}</span>
              {hasNameIconModified && (
                <button
                  onClick={() => {
                    resetDefaultCategoryNameIcon(category.id);
                    setFormData(prev => ({
                      ...prev,
                      name: originalCategory.name,
                      icon: originalCategory.icon
                    }));
                  }}
                  className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                >
                  {t('名字/图标', 'Name/Icon')}
                </button>
              )}
              {hasKeywordsModified && (
                <button
                  onClick={() => {
                    resetDefaultCategoryKeywords(category.id);
                    setFormData(prev => ({
                      ...prev,
                      keywords: originalCategory.keywords.join(', ')
                    }));
                  }}
                  className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                >
                  {t('关键词', 'Keywords')}
                </button>
              )}
              <button
                onClick={() => {
                  resetDefaultCategory(category.id);
                  setFormData({
                    name: originalCategory.name,
                    icon: originalCategory.icon,
                    keywords: originalCategory.keywords.join(', ')
                  });
                }}
                className="text-xs px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
              >
                {t('全部', 'All')}
              </button>
            </div>
          </div>
        )}

        {category && !category.isCustom && !isDefaultCategoryModified && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {t('编辑默认分类将覆盖原始设置，可随时还原。', 'Editing default category will override original settings. You can reset anytime.')}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-4">
          <button
            onClick={handleClose}
            className="flex items-center space-x-2 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>{t('取消', 'Cancel')}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${hasChanges ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400 cursor-not-allowed'}`}
          >
            <Save className="w-4 h-4" />
            <span>{t('保存', 'Save')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};