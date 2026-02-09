(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.WORD_LIST = factory();
  }
})(typeof window !== 'undefined' ? window : global, function () {
  return {
    "Food & Drink": [
      "pizza", "sushi", "tacos", "burger", "pancake", "smoothie",
      "chocolate", "popcorn", "noodles", "waffle", "pretzel",
      "avocado", "mango", "croissant", "dumpling", "burrito",
      "milkshake", "cupcake", "lasagna", "donut"
    ],
    "Animals": [
      "dolphin", "penguin", "elephant", "giraffe", "octopus",
      "flamingo", "cheetah", "gorilla", "hamster", "parrot",
      "kangaroo", "jellyfish", "peacock", "panda", "chameleon",
      "hedgehog", "koala", "lobster", "toucan", "seahorse"
    ],
    "Sports & Activities": [
      "basketball", "surfing", "archery", "bowling", "gymnastics",
      "skateboarding", "fencing", "karate", "volleyball", "cricket",
      "snowboarding", "wrestling", "badminton", "rock climbing",
      "table tennis", "lacrosse", "yoga", "boxing", "sailing",
      "horseback riding"
    ],
    "Household Items": [
      "toaster", "mirror", "blanket", "candle", "bookshelf",
      "doorbell", "lampshade", "curtain", "pillow", "vacuum",
      "bathtub", "scissors", "envelope", "thermostat", "coaster",
      "calendar", "umbrella", "remote control", "alarm clock", "stapler"
    ],
    "Places": [
      "library", "airport", "lighthouse", "aquarium", "volcano",
      "carnival", "museum", "subway", "waterfall", "rooftop",
      "greenhouse", "cathedral", "desert", "igloo", "treehouse",
      "observatory", "harbor", "castle", "glacier", "canyon"
    ],
    "Professions": [
      "astronaut", "detective", "firefighter", "architect", "pilot",
      "surgeon", "lifeguard", "photographer", "mechanic", "journalist",
      "electrician", "veterinarian", "chef", "librarian", "plumber",
      "professor", "paramedic", "carpenter", "pharmacist", "conductor"
    ],
    "Music & Entertainment": [
      "guitar", "drums", "karaoke", "concert", "headphones",
      "microphone", "orchestra", "piano", "violin", "trumpet",
      "harmonica", "turntable", "jukebox", "saxophone", "banjo",
      "accordion", "xylophone", "ukulele", "tambourine", "boombox"
    ],
    "Nature": [
      "rainbow", "tornado", "sunrise", "coral reef", "avalanche",
      "thunderstorm", "meadow", "geyser", "eclipse", "northern lights",
      "tide pool", "fog", "sandstorm", "dew", "quicksand",
      "whirlpool", "crater", "stalactite", "tundra", "oasis"
    ],
    "Clothing & Accessories": [
      "sunglasses", "necktie", "sneakers", "backpack", "bracelet",
      "raincoat", "suspenders", "flip flops", "beanie", "scarf",
      "tuxedo", "apron", "goggles", "locket", "bow tie",
      "sandals", "headband", "overalls", "mittens", "poncho"
    ],
    "Technology": [
      "bluetooth", "drone", "hologram", "smartwatch", "satellite",
      "robot", "3D printer", "VR headset", "webcam", "GPS",
      "projector", "antenna", "server", "joystick", "barcode",
      "touchscreen", "router", "USB drive", "solar panel", "microchip"
    ]
  };
});
